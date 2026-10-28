import { useMemo, useState } from 'react';
import { parseAepCompositionSafe, type AepCompositionJson } from 'reacthub-pixitweenjs';
import { lightValidate } from '../../../server/engine/light-validator';
import Player from '../player/Player';

const modules = import.meta.glob('../../../fixtures/*/valid/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

const fixtures = Object.entries(modules)
  .map(([path, json]) => {
    const m = /fixtures\/([^/]+)\/valid\/([^/]+)\.json$/.exec(path);
    return m ? { label: `${m[1]}/${m[2]}`, json } : null;
  })
  .filter((f): f is { label: string; json: unknown } => f !== null)
  .sort((a, b) => a.label.localeCompare(b.label));

/** Dev page (?fixture=1): play every hand-made valid composition and show both validators' verdicts. */
export function FixturePage() {
  const [label, setLabel] = useState(fixtures[0]?.label ?? '');
  const current = fixtures.find((f) => f.label === label);
  const verdicts = useMemo(
    () => (current ? { engine: parseAepCompositionSafe(current.json).success, light: lightValidate(current.json).ok } : null),
    [current],
  );

  return (
    <main className="grid">
      <section className="slot" data-testid="fixture-page">
        <h2>Fixtures</h2>
        <label>
          Composition{' '}
          <select value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Fixture">
            {fixtures.map((f) => (
              <option key={f.label} value={f.label}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        {verdicts && (
          <p data-testid="verdicts">
            <span>engine: {verdicts.engine ? 'ok' : 'errors'}</span> · <span>light: {verdicts.light ? 'ok' : 'errors'}</span>
          </p>
        )}
        <Player key={label} composition={(current?.json as AepCompositionJson | undefined) ?? null} onError={(e) => console.error('fixture player error', e)} />
      </section>
    </main>
  );
}
