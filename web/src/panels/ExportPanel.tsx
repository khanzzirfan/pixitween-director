// Owned by S8a. Record the film in the browser and offer the download.
import { useEffect, useRef, useState } from 'react';
import { collectAudioPlan } from '../export/audioPlan';
import { exportFileName, extensionForMime, pickRecorderMime } from '../export/formats';
import { exportMp4Exact } from '../export/frameExport';
import { mp4Supported } from '../export/mp4Export';
import { mixAudio } from '../export/mixAudio';
import { getExportCanvas, isDrawingBufferPreserved, playerToDriver } from '../export/playerCanvas';
import { recordCanvas } from '../export/recordCanvas';
import { cancelRenderExport, downloadRenderExport, pollRenderExport, renderExportAvailable, startRenderExport, type ExportQuality } from '../export/renderExport';
import { checkMp4OnServer, exportMp4ViaServer } from '../export/serverExport';
import { EXPORT_READY_WAIT_SEC, ExportError, NOT_READY_MESSAGE, type ExportPlayerHandle } from '../export/types';
import type { PanelProps } from './types';

export const STUB_OWNER = 'S8a' as const;

export interface ExportPanelProps extends PanelProps {
  /** Returns the Player handle at click time (always fresh, unlike a ref value read during render). */
  getPlayer?: () => ExportPlayerHandle | null;
  deps?: {
    recordCanvas?: typeof recordCanvas;
    mixAudio?: typeof mixAudio;
    now?: () => Date;
    mp4Supported?: typeof mp4Supported;
    exportMp4?: typeof exportMp4Exact;
    exportMp4ViaServer?: typeof exportMp4ViaServer;
    checkMp4OnServer?: typeof checkMp4OnServer;
    /** Whether the server has ffmpeg (GET /api/health). */
    serverHasFfmpeg?: () => Promise<boolean>;
    /** Whether the server can build the video itself (GET /api/render-exports/capability). */
    renderExportAvailable?: () => Promise<boolean>;
    startRenderExport?: typeof startRenderExport;
    pollRenderExport?: typeof pollRenderExport;
    downloadRenderExport?: typeof downloadRenderExport;
    cancelRenderExport?: typeof cancelRenderExport;
  };
}

type State =
  | { kind: 'idle' }
  | { kind: 'running'; progress: number; frame?: { n: number; of: number }; label?: string }
  | { kind: 'done'; url: string; name: string; size?: number }
  | { kind: 'error'; message: string };

const SERVER_NOTE = 'Built on the server, without sound.';
type Mp4Path = 'browser' | 'server' | null;

async function healthHasFfmpeg(): Promise<boolean> {
  try {
    const res = await fetch('/api/health');
    return res.ok && ((await res.json()) as { ffmpeg?: boolean }).ffmpeg === true;
  } catch {
    return false;
  }
}

const canRecord = () =>
  typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;

export default function ExportPanel({ film, getPlayer, deps = {} }: ExportPanelProps) {
  const record = deps.recordCanvas ?? recordCanvas;
  const mix = deps.mixAudio ?? mixAudio;
  const now = deps.now ?? (() => new Date());
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [notes, setNotes] = useState<string[]>([]);
  const [format, setFormat] = useState<'webm' | 'mp4'>('webm');
  const [mp4, setMp4] = useState<Mp4Path>(null);
  const abort = useRef<AbortController | null>(null);
  const [serverRender, setServerRender] = useState(false);
  const [quality, setQuality] = useState<ExportQuality>('draft');
  const jobId = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const path: Mp4Path = (await (deps.mp4Supported ?? mp4Supported)()) ? 'browser' : (await (deps.serverHasFfmpeg ?? healthHasFfmpeg)()) ? 'server' : null;
      if (alive) setMp4(path);
    })();
    void (deps.renderExportAvailable ?? renderExportAvailable)().then((ok) => alive && setServerRender(ok));
    return () => void (alive = false);
  }, []);

  const comp = film?.composition ?? null;
  const supported = canRecord();
  const hasContent = !!comp && comp.durationInFrames > 0;

  async function startOnServer() {
    if (!film?.id) return;
    const ctl = new AbortController();
    abort.current = ctl;
    jobId.current = null;
    setNotes([]);
    setState({ kind: 'running', progress: 0, label: 'Starting the export…' });
    try {
      const job = await (deps.startRenderExport ?? startRenderExport)(film.id, quality);
      jobId.current = job.id;
      const last = await (deps.pollRenderExport ?? pollRenderExport)(job.id, {
        signal: ctl.signal,
        onView: (v) =>
          setState({
            kind: 'running',
            progress: Math.round(v.progress * 100),
            frame: v.status === 'rendering' ? { n: v.frame, of: v.frames } : undefined,
            label: v.status === 'encoding' ? 'Building your MP4…' : 'Rendering your film…',
          }),
      });
      if (last.status === 'cancelled') return setState({ kind: 'idle' });
      if (last.status === 'error') throw new ExportError('recorder-error', last.error ?? 'The export failed.');
      setState({ kind: 'running', progress: 100, label: 'Getting your file ready…' });
      const blob = await (deps.downloadRenderExport ?? downloadRenderExport)(job.id);
      setNotes(last.problems);
      setState({ kind: 'done', url: URL.createObjectURL(blob), name: last.fileName ?? exportFileName(film.title ?? 'film', 'mp4', now()), size: blob.size });
    } catch (e) {
      setState(ctl.signal.aborted ? { kind: 'idle' } : { kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  function cancel() {
    abort.current?.abort();
    if (jobId.current) void (deps.cancelRenderExport ?? cancelRenderExport)(jobId.current);
  }

  async function start() {
    if (serverRender) return startOnServer();
    if (!comp) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setNotes([]);
    setState({ kind: 'running', progress: 0 });
    try {
      const handle = getPlayer?.() ?? null;
      const canvas = getExportCanvas(handle);
      // a 3D product that has not drawn would be recorded as an empty frame: wait for it, and never start the recorder without it
      if (handle?.whenReady && !(await handle.whenReady(EXPORT_READY_WAIT_SEC))) throw new ExportError('not-ready', NOT_READY_MESSAGE);
      const durationSec = comp.durationInFrames / comp.fps;
      const messages: string[] = [];
      if (isDrawingBufferPreserved(canvas) === false) messages.push('Export may produce blank frames in this browser.');

      const plan = collectAudioPlan(comp);
      const mixed = await mix(plan, durationSec);
      if (plan.length > 0 && mixed.buffer === null) messages.push('Exported without audio');
      else if (mixed.warnings.length) messages.push(`Exported without audio from: ${mixed.warnings.map((w) => w.layerId).join(', ')}`);

      const driver = playerToDriver(handle!);
      const totalFrames = Math.ceil(durationSec * comp.fps);
      const onProgress = (p: { fraction: number }) =>
        setState({ kind: 'running', progress: Math.round(p.fraction * 100), frame: format === 'mp4' ? { n: Math.round(p.fraction * totalFrames), of: totalFrames } : undefined });
      let blob: Blob;
      let ext: string;
      if (format === 'mp4' && mp4 === 'server') {
        const r = await (deps.exportMp4ViaServer ?? exportMp4ViaServer)({ canvas, driver, durationSec, fps: comp.fps, onProgress, signal: ctl.signal });
        blob = r.blob;
        messages.push(SERVER_NOTE, ...r.problems);
        ext = 'mp4';
      } else if (format === 'mp4') {
        blob = await (deps.exportMp4 ?? exportMp4Exact)({ canvas, driver, durationSec, fps: comp.fps, audio: mixed.buffer, onProgress, signal: ctl.signal });
        messages.push(...(await (deps.checkMp4OnServer ?? checkMp4OnServer)(blob, { durationSec, fps: comp.fps, width: canvas.width, height: canvas.height })));
        ext = 'mp4';
      } else {
        const mimeType = pickRecorderMime((m) => MediaRecorder.isTypeSupported(m));
        if (!mimeType) throw new ExportError('unsupported', "Your browser can't record video. Try Chrome.");
        blob = await record({ canvas, driver, durationSec, audio: mixed.buffer, mimeType, onProgress, signal: ctl.signal });
        ext = extensionForMime(mimeType);
      }
      setNotes(messages);
      setState({ kind: 'done', url: URL.createObjectURL(blob), name: exportFileName(film?.title ?? 'film', ext, now()) });
    } catch (e) {
      setState(
        e instanceof ExportError && e.code === 'aborted'
          ? { kind: 'idle' }
          : { kind: 'error', message: e instanceof Error ? e.message : String(e) },
      );
    }
  }

  function dismiss() {
    if (state.kind === 'done') URL.revokeObjectURL(state.url);
    setNotes([]);
    setState({ kind: 'idle' });
  }

  return (
    <div>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">READY FOR THE WORLD</span>
          <h2>Export your film</h2>
        </div>
        <span className="step-pill">FINAL STEP</span>
      </div>
      {state.kind === 'idle' && (
        <>
          {serverRender && (
            <label>
              Quality{' '}
              <select value={quality} onChange={(e) => setQuality(e.target.value as ExportQuality)} aria-label="Quality">
                <option value="draft">Quick (540×960, 15 fps)</option>
                <option value="full">Full (1080×1920, 30 fps, slower)</option>
              </select>
            </label>
          )}
          {!serverRender && mp4 !== null && (
            <label>
              Format{' '}
              <select value={format} onChange={(e) => setFormat(e.target.value as 'webm' | 'mp4')} aria-label="Format">
                <option value="webm">WebM</option>
                <option value="mp4">MP4</option>
              </select>
            </label>
          )}
          <button
            className="primary"
            type="button"
            aria-label="Export video"
            onClick={() => void start()}
            disabled={(!serverRender && !supported) || !hasContent}
          >
            Export video →
          </button>
          {!serverRender && !supported && <p>Your browser can&apos;t record video. Try Chrome.</p>}
          {(serverRender || supported) && !hasContent && <p>Nothing to export</p>}
        </>
      )}
      {state.kind === 'running' && (
        <div>
          <p>{state.label ?? 'Preparing your video…'}</p>
          <div className="export-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.progress}>
            <span style={{ width: `${state.progress}%` }} />
          </div>
          <p>{state.frame ? `Rendering frame ${state.frame.n} of ${state.frame.of}` : `${state.progress}% complete`}</p>
          <button type="button" onClick={cancel}>
            Cancel
          </button>
        </div>
      )}
      {state.kind === 'done' && (
        <div>
          <a href={state.url} download={state.name}>
            Download {state.name}
          </a>
          {state.size ? ` (${(state.size / 1_000_000).toFixed(1)} MB)` : ''}{' '}
          <button type="button" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      )}
      {state.kind === 'error' && (
        <div role="alert">
          <p>{state.message}</p>
          <button type="button" onClick={() => setState({ kind: 'idle' })}>
            Try again
          </button>
        </div>
      )}
      {notes.map((n) => (
        <p key={n}>{n}</p>
      ))}
    </div>
  );
}
