// Owned by S8a. Record the film in the browser and offer the download.
import { useEffect, useRef, useState } from 'react';
import { collectAudioPlan } from '../export/audioPlan';
import { exportFileName, extensionForMime, pickRecorderMime } from '../export/formats';
import { exportMp4, mp4Supported } from '../export/mp4Export';
import { mixAudio } from '../export/mixAudio';
import { getExportCanvas, isDrawingBufferPreserved, playerToDriver } from '../export/playerCanvas';
import { recordCanvas } from '../export/recordCanvas';
import { ExportError, type ExportPlayerHandle } from '../export/types';
import type { PanelProps } from './types';

export const STUB_OWNER = 'S8a' as const;

export interface ExportPanelProps extends PanelProps {
  /** Returns the Player handle at click time (always fresh, unlike a ref value read during render). */
  getPlayer?: () => ExportPlayerHandle | null;
  deps?: { recordCanvas?: typeof recordCanvas; mixAudio?: typeof mixAudio; now?: () => Date; mp4Supported?: typeof mp4Supported; exportMp4?: typeof exportMp4 };
}

type State =
  | { kind: 'idle' }
  | { kind: 'running'; progress: number }
  | { kind: 'done'; url: string; name: string }
  | { kind: 'error'; message: string };

const canRecord = () => typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;

export default function ExportPanel({ film, getPlayer, deps = {} }: ExportPanelProps) {
  const record = deps.recordCanvas ?? recordCanvas;
  const mix = deps.mixAudio ?? mixAudio;
  const now = deps.now ?? (() => new Date());
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [notes, setNotes] = useState<string[]>([]);
  const [format, setFormat] = useState<'webm' | 'mp4'>('webm');
  const [mp4, setMp4] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    void (deps.mp4Supported ?? mp4Supported)().then((ok) => alive && setMp4(ok));
    return () => void (alive = false);
  }, []);

  const comp = film?.composition ?? null;
  const supported = canRecord();
  const hasContent = !!comp && comp.durationInFrames > 0;

  async function start() {
    if (!comp) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setNotes([]);
    setState({ kind: 'running', progress: 0 });
    try {
      const handle = getPlayer?.() ?? null;
      const canvas = getExportCanvas(handle);
      const durationSec = comp.durationInFrames / comp.fps;
      const messages: string[] = [];
      if (isDrawingBufferPreserved(canvas) === false) messages.push('Export may produce blank frames in this browser.');

      const plan = collectAudioPlan(comp);
      const mixed = await mix(plan, durationSec);
      if (plan.length > 0 && mixed.buffer === null) messages.push('Exported without audio');
      else if (mixed.warnings.length) messages.push(`Exported without audio from: ${mixed.warnings.map((w) => w.layerId).join(', ')}`);

      const driver = playerToDriver(handle!);
      const onProgress = (p: { fraction: number }) => setState({ kind: 'running', progress: Math.round(p.fraction * 100) });
      let blob: Blob;
      let ext: string;
      if (format === 'mp4') {
        blob = await (deps.exportMp4 ?? exportMp4)({ canvas, driver, durationSec, audio: mixed.buffer, onProgress, signal: ctl.signal });
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
      setState(e instanceof ExportError && e.code === 'aborted' ? { kind: 'idle' } : { kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  function dismiss() {
    if (state.kind === 'done') URL.revokeObjectURL(state.url);
    setNotes([]);
    setState({ kind: 'idle' });
  }

  return (
    <div>
      <h2>Export</h2>
      {state.kind === 'idle' && (
        <>
          {mp4 && (
            <label>
              Format{' '}
              <select value={format} onChange={(e) => setFormat(e.target.value as 'webm' | 'mp4')} aria-label="Format">
                <option value="webm">WebM</option>
                <option value="mp4">MP4 (experimental)</option>
              </select>
            </label>
          )}
          <button type="button" onClick={() => void start()} disabled={!supported || !hasContent}>Export video</button>
          {!supported && <p>Your browser can&apos;t record video. Try Chrome.</p>}
          {supported && !hasContent && <p>Nothing to export</p>}
        </>
      )}
      {state.kind === 'running' && (
        <div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.progress}>{state.progress}%</div>
          <button type="button" onClick={() => abort.current?.abort()}>Cancel</button>
        </div>
      )}
      {state.kind === 'done' && (
        <div>
          <a href={state.url} download={state.name}>Download {state.name}</a>{' '}
          <button type="button" onClick={dismiss}>Dismiss</button>
        </div>
      )}
      {state.kind === 'error' && (
        <div role="alert">
          <p>{state.message}</p>
          <button type="button" onClick={() => setState({ kind: 'idle' })}>Try again</button>
        </div>
      )}
      {notes.map((n) => <p key={n}>{n}</p>)}
    </div>
  );
}
