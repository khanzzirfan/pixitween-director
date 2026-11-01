// Dev page (/motion-lab.html, not linked from the app): pick a fixture, edit its JSON live and watch it play
// through the real <MotionPlayer>, so docs can be authored and debugged by hand (engine/docs/06-runtime-player.md,
// "Lab page"). window.__motion exposes the test hooks the e2e spec drives.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionPlayer, type MotionHandle } from '../src/react/MotionPlayer';
import { captureFrame, contactSheet, evenFrames, exportPack, renderPass } from '../src/runtime/capture';
import { parseMotionDoc, type MotionDocError, type MotionDocInput } from '../src/schema';

const modules = import.meta.glob('../fixtures/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

const FIXTURES = Object.fromEntries(
  Object.entries(modules).map(([path, json]) => [path.replace(/^.*\/([^/]+)\.json$/, '$1'), json]),
);

const FIXTURE_NAMES = Object.keys(FIXTURES).sort();

const DEBOUNCE_MS = 400;

/** SHA-256 (first 12 hex chars) of a 64x36 downscale of the canvas (engine/lab/three-smoke.tsx). */
async function hashCanvas(canvas: HTMLCanvasElement | null): Promise<string> {
  if (!canvas) return 'no canvas';
  const small = document.createElement('canvas');
  small.width = 64;
  small.height = 36;
  const ctx = small.getContext('2d');
  if (!ctx) return 'no 2d';
  ctx.drawImage(canvas, 0, 0, 64, 36);
  const digest = await crypto.subtle.digest('SHA-256', ctx.getImageData(0, 0, 64, 36).data);
  return [...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function formatErrors(errors: MotionDocError[]): string[] {
  return errors.map((error) => `${error.path}: ${error.message}`);
}

function MotionLab() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialName = params.get('doc');
  const [name, setName] = useState(initialName && FIXTURES[initialName] ? initialName : FIXTURE_NAMES[0]);
  const [text, setText] = useState(() => JSON.stringify(FIXTURES[name], null, 2));
  const [doc, setDoc] = useState<MotionDocInput>(() => FIXTURES[name] as MotionDocInput);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [docErrors, setDocErrors] = useState<string[]>([]);
  const [layerErrors, setLayerErrors] = useState<string[]>([]);
  const [hash, setHash] = useState('');

  const player = useRef<MotionHandle>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Switching fixtures resets the textarea to that fixture's own JSON.
  useEffect(() => {
    const json = FIXTURES[name];
    setText(JSON.stringify(json, null, 2));
    setDoc(json as MotionDocInput);
    setJsonError(null);
    setDocErrors([]);
    setLayerErrors([]);
  }, [name]);

  useEffect(() => {
    const t = Number(params.get('t'));
    if (!t) return;
    const id = setTimeout(() => player.current?.seek(t), 1500);
    return () => clearTimeout(id);
  }, [params, name]);

  const onTextChange = useCallback((value: string) => {
    setText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch (error) {
        setJsonError(error instanceof Error ? error.message : String(error));
        return;
      }
      const result = parseMotionDoc(parsed);
      if (!result.ok) {
        setJsonError(null);
        setDocErrors(formatErrors(result.errors));
        return;
      }
      setJsonError(null);
      setDocErrors([]);
      setLayerErrors([]);
      setDoc(parsed as MotionDocInput);
    }, DEBOUNCE_MS);
  }, []);

  const refreshHash = useCallback(async () => {
    setHash(await hashCanvas(player.current?.getCanvas() ?? null));
  }, []);

  const ready = useCallback(async () => {
    const ok = (await player.current?.whenReady(10)) ?? false;
    await refreshHash();
    return ok;
  }, [refreshHash]);

  const pixel = useCallback(
    (x: number, y: number): [number, number, number, number] => player.current?.readPixel(x, y) ?? [0, 0, 0, 0],
    [],
  );

  // Capture buttons: download a PNG of the frame under the playhead, a 12-frame sheet, or a pass.
  const download = useCallback((blob: Blob, filename: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, []);

  const capture = useCallback(
    async (kind: 'frame' | 'sheet' | 'depth' | 'normal'): Promise<Blob | null> => {
      const rt = player.current?.getRuntime?.();
      if (!rt) return null;
      const fps = rt.getFps();
      const frame = Math.round(rt.getTime() * fps);
      const lastFrame = Math.max(0, Math.round(rt.getDuration() * fps) - 1);
      let blob: Blob;
      if (kind === 'frame') blob = await captureFrame(rt, frame);
      else if (kind === 'sheet') blob = await contactSheet(rt, evenFrames(12, 0, lastFrame), 4);
      else blob = await renderPass(rt, frame, kind);
      download(blob, `${name}-${kind}.png`);
      return blob;
    },
    [download, name],
  );

  // Export pack: first, last, depth, normal, contact sheet, camera.json, summary.txt for the whole shot.
  const [notes, setNotes] = useState('');
  const pack = useCallback(async (): Promise<string[]> => {
    const rt = player.current?.getRuntime?.();
    if (!rt) return [];
    const lastFrame = Math.max(0, Math.round(rt.getDuration() * rt.getFps()) - 1);
    const p = await exportPack(rt, { from: 0, to: lastFrame });
    const files: Array<[string, Blob]> = [
      [`${name}-first.png`, p.first],
      [`${name}-last.png`, p.last],
      [`${name}-depth.png`, p.firstDepth],
      [`${name}-normal.png`, p.firstNormal],
      [`${name}-contact-sheet.png`, p.contactSheet],
      [`${name}-camera.json`, new Blob([JSON.stringify(p.camera)], { type: 'application/json' })],
      [`${name}-summary.txt`, new Blob([p.summary], { type: 'text/plain' })],
    ];
    for (const [filename, blob] of files) {
      download(blob, filename);
      await new Promise((r) => setTimeout(r, 150));
    }
    const names = files.map(([n]) => n);
    setNotes(`Exported ${names.length} files: ${names.join(', ')}`);
    return names;
  }, [download, name]);

  const errors = useCallback(() => [...docErrors, ...layerErrors], [docErrors, layerErrors]);

  useEffect(() => {
    (window as unknown as { __motion: unknown }).__motion = {
      handle: player.current,
      ready,
      hash: () => hashCanvas(player.current?.getCanvas() ?? null),
      pixel,
      errors,
      capture,
      pack,
    };
  }, [ready, pixel, errors, capture, pack, doc]);

  return (
    <main style={{ padding: 16, color: '#e5e7eb', background: '#0b0f19', minHeight: '100vh', fontFamily: 'monospace' }}>
      <h1>motion lab</h1>
      <p>
        Fixture{' '}
        <select value={name} onChange={(event) => setName(event.target.value)} aria-label="Fixture">
          {FIXTURE_NAMES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </p>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ lineHeight: 0 }}>
          <MotionPlayer
            ref={player}
            doc={doc}
            displayWidth={720}
            onDocErrors={(docErr) => setDocErrors(formatErrors(docErr))}
            onLayerError={(layerId, message) => setLayerErrors((prev) => [...prev, `${layerId}: ${message}`])}
          />
        </div>
        <textarea
          aria-label="Doc JSON"
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          spellCheck={false}
          style={{
            width: 480,
            height: 480,
            background: '#111827',
            color: '#e5e7eb',
            fontFamily: 'monospace',
            fontSize: 12,
          }}
        />
      </div>
      <p>
        <button type="button" onClick={() => void refreshHash()}>
          Hash canvas
        </button>
      </p>
      <p>
        {(['frame', 'sheet', 'depth', 'normal'] as const).map((kind) => (
          <button key={kind} type="button" onClick={() => void capture(kind)} style={{ marginRight: 8 }}>
            {kind === 'frame' ? 'Frame PNG' : kind === 'sheet' ? 'Contact sheet (12)' : `${kind[0].toUpperCase()}${kind.slice(1)} pass`}
          </button>
        ))}
      </p>
      <p>
        <button type="button" onClick={() => void pack()}>
          Export pack
        </button>
      </p>
      {notes !== '' && <p data-testid="notes">{notes}</p>}
      {hash !== '' && <p data-testid="hash">{hash}</p>}
      {jsonError !== null && <p data-testid="json-error">invalid JSON: {jsonError}</p>}
      {docErrors.length > 0 && <p data-testid="doc-errors">{docErrors.join('; ')}</p>}
      {layerErrors.length > 0 && <p data-testid="layer-errors">{layerErrors.join('; ')}</p>}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<MotionLab />);
