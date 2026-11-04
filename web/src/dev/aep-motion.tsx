// Dev page (/aep-motion.html?film=<id>, not linked from the app): loads a stored film, converts its composition with
// aepToMotion and plays it on the Motion engine so it can be compared with the studio player.
// window.__aepMotion exposes test hooks for screenshots (seek to a fraction of the duration).
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { FilmState } from '@shared/composition';
import { MotionPlayer, type MotionHandle } from '@engine/react/MotionPlayer';
import { parseAepCompositionSafe } from '@shared/aep/parse';
import { aepToMotion, type AepToMotionResult } from '../motion/aep';

function countLayers(layers: ReadonlyArray<{ type: string; children?: unknown }>): number {
  let n = 0;
  for (const l of layers) {
    n += 1;
    if (l.type === 'group' && Array.isArray(l.children)) n += countLayers(l.children as typeof layers);
  }
  return n;
}

function AepMotion() {
  const filmId = useMemo(() => new URLSearchParams(window.location.search).get('film'), []);
  // ?src=<url of a bare composition json>, e.g. a produced catalogue film under /cartoon/catalog/
  const src = useMemo(() => new URLSearchParams(window.location.search).get('src'), []);
  const [result, setResult] = useState<AepToMotionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layerErrors, setLayerErrors] = useState<string[]>([]);
  const player = useRef<MotionHandle>(null);

  useEffect(() => {
    let live = true;
    if (src) {
      fetch(src)
        .then(async (res) => {
          if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
          const parsed = parseAepCompositionSafe(await res.json());
          if (!parsed.success) throw new Error(`${src}: parse failed: ${parsed.error.message.slice(0, 300)}`);
          if (live) setResult(aepToMotion(parsed.data));
        })
        .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
      return () => {
        live = false;
      };
    }
    if (!filmId) {
      setError('missing ?film=<id> or ?src=<url>');
      return;
    }
    fetch(`/api/films/${encodeURIComponent(filmId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`film ${filmId}: HTTP ${res.status}`);
        const film = (await res.json()) as FilmState;
        if (!film.composition) throw new Error(`film ${filmId} has no composition yet`);
        if (live) setResult(aepToMotion(film.composition));
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [filmId, src]);

  useEffect(() => {
    (window as unknown as { __aepMotion: unknown }).__aepMotion = {
      ready: async () => (await player.current?.whenReady(15)) ?? false,
      seekFraction: (f: number) => {
        const p = player.current;
        if (p) p.seek(p.getDuration() * f);
      },
      layerErrors: () => layerErrors,
      warnings: () => result?.warnings ?? [],
      canvas: () => document.querySelector('canvas'),
    };
  }, [layerErrors, result]);

  if (error) return <pre data-testid="error" style={{ color: 'crimson', padding: 16 }}>{error}</pre>;
  if (!result) return <p style={{ padding: 16 }}>Loading {filmId}…</p>;

  const layers = countLayers(result.doc.layers);
  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <p data-testid="summary">
        film {filmId ?? src}: layers={layers} warnings={result.warnings.length} audio={result.audio.length}
      </p>
      <MotionPlayer ref={player} doc={result.doc} displayWidth={800} onLayerError={(id, m) => setLayerErrors((e) => [...e, `${id}: ${m}`])} />
      {result.warnings.length > 0 && (
        <details>
          <summary>Warnings</summary>
          <ul>
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<AepMotion />);
