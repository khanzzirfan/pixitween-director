// Owned by S7b. The noun SAM is asked to find in the clip: from the composition, a cache, or one Spark call.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FilmState } from '@shared/composition';
import type { ToolCtx } from '@shared/tools';
import { getProductNoun, type Comp } from '../authoring/api';

const FALLBACK = 'product';

export function sanitizeNoun(text: string): string {
  const words = text.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 3);
  const noun = words.join(' ').slice(0, 40).trim();
  return noun || FALLBACK;
}

export async function resolveProductNoun(ctx: ToolCtx, film: FilmState, comp: Comp, deps: { cacheDir: string }): Promise<string> {
  const fromComp = getProductNoun(comp);
  if (fromComp && fromComp.trim()) return fromComp;

  const cacheFile = join(deps.cacheDir, 'product-noun.json');
  try {
    const cached = (JSON.parse(await readFile(cacheFile, 'utf8')) as { noun?: unknown }).noun;
    if (typeof cached === 'string' && cached.trim()) return cached;
  } catch {
    // no cache yet
  }

  try {
    const res = await ctx.meta.spark.chat({
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Name the product in a film brief. Reply with JSON only.' },
        { role: 'user', content: `Brief: ${film.brief.text.slice(0, 300)}\nReply as {"noun": "<one lowercase noun phrase naming the product>"}.` },
      ],
    });
    ctx.ledger.add(ctx.filmId, 'muse-spark-1.3-contributor', '1 call', 0.002);
    const parsed = JSON.parse(res.content ?? '') as { noun?: unknown };
    if (typeof parsed.noun !== 'string') return FALLBACK;
    const noun = sanitizeNoun(parsed.noun);
    if (noun === FALLBACK) return FALLBACK;
    await mkdir(deps.cacheDir, { recursive: true });
    await writeFile(cacheFile, JSON.stringify({ noun }));
    return noun;
  } catch {
    return FALLBACK;
  }
}
