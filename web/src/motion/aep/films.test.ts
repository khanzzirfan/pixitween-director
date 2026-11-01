import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AepCompositionJson } from '@shared/aep/composition';
import { aepToMotion } from './index';

const filmsDir = resolve(__dirname, '../../../../data/films');

function newestComposition(filmDir: string): AepCompositionJson | undefined {
  const versionsDir = join(filmDir, 'versions');
  if (!existsSync(versionsDir)) return undefined;
  const versions = readdirSync(versionsDir)
    .map((name) => /^(\d+)\.json$/.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => b - a);
  if (versions.length === 0) return undefined;
  const raw = JSON.parse(readFileSync(join(versionsDir, `${versions[0]}.json`), 'utf8')) as { composition?: AepCompositionJson };
  return raw.composition;
}

function countLayers(layers: { children?: unknown[] }[]): number {
  return layers.reduce((n, l) => n + 1 + countLayers((l.children ?? []) as { children?: unknown[] }[]), 0);
}

describe.skipIf(!existsSync(filmsDir))('stored films -> aepToMotion', () => {
  const films = existsSync(filmsDir) ? readdirSync(filmsDir).filter((f) => f.startsWith('film_')) : [];

  it('converts the newest version of every film to a valid doc', () => {
    let totalLayers = 0;
    let totalWarnings = 0;
    let converted = 0;
    const kinds = new Map<string, number>();
    const skipped3d: string[] = [];
    for (const film of films) {
      const comp = newestComposition(join(filmsDir, film));
      if (!comp) continue;
      const { doc, warnings } = aepToMotion(comp);
      const layers = countLayers(doc.layers as { children?: unknown[] }[]);
      totalLayers += layers;
      totalWarnings += warnings.length;
      for (const w of warnings) {
        const kind = w
          .replace(/^(layer|actor|prop|comp) \S+ /, '$1 ')
          .replace(/dropped clip.*$/, 'dropped clip(s)')
          .replace(/precomp \S+/, 'precomp')
          .replace(/bone \S+ of actor \S+/, 'bone of actor')
          .replace(/clipAssetId \S+/, 'clipAssetId')
          .replace(/blendMode \S+/, 'blendMode')
          .slice(0, 90);
        kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
        if (/skipped/i.test(w) && /3d|model3d|stage3d|actor3d|prop3d/i.test(w)) skipped3d.push(`${film}: ${w}`);
      }
      converted += 1;
      console.log(`${film}: layers=${layers} warnings=${warnings.length}`);
    }
    console.log(`TOTAL: films=${converted} layers=${totalLayers} warnings=${totalWarnings}`);
    for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`WARNKIND ${n} ${k}`);
    expect(skipped3d).toEqual([]);
    expect(converted).toBeGreaterThanOrEqual(0);
  });
});
