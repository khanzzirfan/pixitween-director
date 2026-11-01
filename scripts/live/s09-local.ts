// Manual gate MG-1: measures six scripted edits and one frame review on Muse Glimmer through Ollama. Never run by tests.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { LlmBackend } from '@shared/ports';
import { runEditWithCtx } from '../../server/agent/edit-loop';
import { makeGlimmerBackend } from '../../server/llm/glimmer-backend';
import { glimmerReviewImages } from '../../server/llm/glimmer/review';
import { SCRIPTED_EDITS, buildSampleFilm, scoreEdit } from '../../server/llm/glimmer/ab';
import { getGlimmerStatus } from '../../server/llm/local-mode';
import { makeTestFilm } from '../../server/test-utils/film';
import type { LiveScript } from './run';

export const describe: LiveScript['describe'] = () =>
  'Needs Ollama running with the model pulled (ollama pull muse-glimmer:30b-mlx). Runs six scripted edits and one frame review on Muse Glimmer and prints a table of correctness and time. Cost is 0 locally; --with-spark also runs the same edits on Muse Spark through the API (about one cent). The global Local-mode flag is never changed.';

export const estimateUsd = (args: string[] = process.argv.slice(2)): number => (args.includes('--with-spark') ? 0.01 : 0);

export interface AbRow {
  edit: string;
  backend: 'glimmer' | 'spark';
  correct: boolean;
  ms: number;
  toolCallsOk: number;
  tokPerSec?: number;
  note?: string;
}

export function formatAbTable(rows: AbRow[]): string {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [
    line(['edit', 'backend', 'correct', 'ms', 'tool calls ok', 'tok/s']),
    line(['---', '---', '---', '---', '---', '---']),
    ...rows.map((r) => line([r.edit, r.backend, r.correct ? 'yes' : 'no', String(r.ms), String(r.toolCallsOk), r.tokPerSec === undefined ? '-' : String(r.tokPerSec)])),
  ].join('\n');
}

export function nextIterationDir(existing: string[]): string {
  const n = Math.max(0, ...existing.map((d) => Number(/^iteration-(\d+)$/.exec(d)?.[1] ?? 0))) + 1;
  return `iteration-${String(n).padStart(2, '0')}`;
}

/** Wraps a backend to remember each turn's tokens per second, which the edit loop does not keep. */
function measured(inner: LlmBackend): LlmBackend & { rates: number[] } {
  const rates: number[] = [];
  return {
    id: inner.id,
    rates,
    async chatWithTools(...args) {
      const r = await inner.chatWithTools(...args);
      const rate = (r.usage as { tokPerSec?: number } | undefined)?.tokPerSec;
      if (rate) rates.push(rate);
      return r;
    },
  };
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: { pass: { type: 'boolean' }, issues: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string' }, evidence: { type: 'string' } }, required: ['kind', 'evidence'] } } },
  required: ['pass', 'issues'],
};

export const run: LiveScript['run'] = async ({ env, log }) => {
  const status = await getGlimmerStatus({ forceRefresh: true });
  if (!status.reachable) throw new Error(`Ollama is not reachable at ${status.host}. Start it with \`ollama serve\`.`);
  if (!status.modelPresent) throw new Error(`Model not found. Pull it with \`ollama pull ${status.model}\`.`);
  const withSpark = process.argv.includes('--with-spark');

  const rows: AbRow[] = [];
  const warnings: string[] = [];
  for (const edit of SCRIPTED_EDITS) {
    for (const side of withSpark ? (['glimmer', 'spark'] as const) : (['glimmer'] as const)) {
      const t = await makeTestFilm({ composition: buildSampleFilm() });
      const before = (await t.films.get(t.filmId)).composition!;
      const backend =
        side === 'glimmer'
          ? measured(makeGlimmerBackend({ baseUrl: env.GLIMMER_BASE_URL, model: env.GLIMMER_MODEL, task: 'edit', numCtx: env.GLIMMER_NUM_CTX, skipClosingTurn: true, onWarning: (m) => warnings.push(`${edit.id}: ${m}`) }))
          : undefined;
      const started = Date.now();
      let note: string | undefined;
      let outcome;
      try {
        outcome = await runEditWithCtx(t.ctx, { message: edit.message, selection: edit.selection, local: side === 'glimmer' }, backend ? { backend } : {});
      } catch (e) {
        note = e instanceof Error ? e.message : String(e);
      }
      const after = (await t.films.get(t.filmId)).composition!;
      const score = scoreEdit(edit.id, before, after);
      const rates = backend ? backend.rates : [];
      const why = note ?? (score.pass ? undefined : score.reasons.join('; '));
      rows.push({
        edit: edit.id, backend: side, correct: score.pass, ms: Date.now() - started, toolCallsOk: outcome?.applied ?? 0,
        ...(rates.length ? { tokPerSec: Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10 } : {}),
        ...(why ? { note: why } : {}),
      });
      log(`${edit.id} (${side}): ${score.pass ? 'correct' : `wrong: ${score.reasons.join('; ')}`}`);
    }
  }

  // one frame review: draw the headline across the mug and ask whether the text covers the product
  const photo = await sharp('fixtures/seed/cafe-with-mug.jpg').metadata();
  const svg = `<svg width="${photo.width}" height="${photo.height}" xmlns="http://www.w3.org/2000/svg"><text x="50%" y="55%" font-size="72" fill="white" stroke="black" stroke-width="3" text-anchor="middle" font-family="sans-serif">Slow mornings</text></svg>`;
  const frame = await sharp('fixtures/seed/cafe-with-mug.jpg').composite([{ input: Buffer.from(svg) }]).jpeg().toBuffer();
  const reviewStart = Date.now();
  const verdict = await glimmerReviewImages([frame], 'This is a frame from a product film. Does any text cover the product? Answer as JSON with pass and issues.', REVIEW_SCHEMA, { baseUrl: env.GLIMMER_BASE_URL, model: env.GLIMMER_MODEL });
  const reviewMs = Date.now() - reviewStart;
  log(`frame review: ${reviewMs} ms, verdict ${JSON.stringify(verdict)}`);

  const table = formatAbTable(rows);
  log(`\n${table}`);
  if (warnings.length) log(`\nwarnings:\n${warnings.join('\n')}`);
  const root = join('debug', 's09');
  mkdirSync(root, { recursive: true });
  const dir = join(root, nextIterationDir(readdirSync(root)));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'ab.json'), JSON.stringify({ rows, warnings, review: { ms: reviewMs, verdict } }, null, 2));
  writeFileSync(join(dir, 'ab.md'), `${table}\n`);
  log(`written to ${dir}`);
};
