// Manual gate MG-1: sends the four synthetic frames to real Spark and checks it finds what each one is known to contain.
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCtx } from '@shared/tools';
import { createEventBus } from '../../server/events/bus';
import { emitStamped } from '../../server/http/deps';
import { createLedger } from '../../server/ledger';
import { createMetaClients } from '../../server/meta';
import { visualReview } from '../../server/review/visual';
import { makeSyntheticFrames } from '../../server/review/synth-frames';
import { allTools } from '../../server/tools/registry';
import type { LiveScript } from './run';

export const describe: LiveScript['describe'] = () =>
  'Sends the 4 synthetic frames (clean, text over the product, low contrast, product missing) to real Muse Spark, one vision call each, and checks the grounded issues against what each frame is known to contain. Needs META_API_KEY. Writes report.json and verdicts.md to debug/s05/iteration-NN/. Estimated about $0.05 (ceiling $0.50).';

export const estimateUsd: LiveScript['estimateUsd'] = () => 0.05;

export interface ReportRow {
  name: string;
  expected: string[];
  grounded: string[];
  dropped: number;
  ok: boolean;
  error?: string;
}

/** A row is right when the grounded issue kinds are exactly the expected ones. */
export const rowOk = (expected: string[], grounded: string[]): boolean => expected.length === new Set(grounded).size && expected.every((k) => grounded.includes(k));

export function formatReport(rows: ReportRow[]): string {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [
    line(['frame', 'expected', 'grounded', 'dropped', 'result']),
    line(['---', '---', '---', '---', '---']),
    ...rows.map((r) => line([r.name, r.expected.join(', ') || 'none', r.error ? `error: ${r.error}` : r.grounded.join(', ') || 'none', String(r.dropped), r.ok ? 'pass' : 'FAIL'])),
  ].join('\n');
}

const nextDir = (root: string): string => {
  mkdirSync(root, { recursive: true });
  const n = readdirSync(root).filter((d) => /^iteration-\d+$/.test(d)).length + 1;
  const dir = join(root, `iteration-${String(n).padStart(2, '0')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

export const run: LiveScript['run'] = async ({ env, log }) => {
  if (!env.metaApiKey) throw new Error('META_API_KEY is not set. Add it to .env, then run again.');

  const dir = mkdtempSync(join(tmpdir(), 's05-live-'));
  const bus = createEventBus(dir);
  const filmId = 'film_000000000005';
  const ledger = createLedger({ dir, emit: (id, e) => emitStamped(bus, id, e) });
  const ctx = { filmId, meta: createMetaClients(env), ledger } as unknown as ToolCtx;

  const rows: ReportRow[] = [];
  const verdicts: string[] = [];
  for (const frame of await makeSyntheticFrames()) {
    try {
      const out = await visualReview({
        ctx,
        sceneId: 's1',
        frames: [{ image: frame.jpeg, atSec: frame.atSec }],
        findings: [],
        layerSummary: ['- s1:bg (image): a cafe counter', '- s1:product (image): a white ceramic mug on the counter', '- s1:caption (text): "Slow mornings"'],
        layerIds: ['s1:bg', 's1:product', 's1:caption'],
        tools: allTools(),
        local: false,
      });
      const grounded = [...new Set(out.verdict.issues.map((i) => i.kind))];
      rows.push({ name: frame.name, expected: frame.expected.kinds, grounded, dropped: out.dropped.length, ok: rowOk(frame.expected.kinds, grounded) });
      verdicts.push(`## ${frame.name}\n\n${JSON.stringify(out.verdict, null, 2)}\n`);
    } catch (e) {
      rows.push({ name: frame.name, expected: frame.expected.kinds, grounded: [], dropped: 0, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    log(`${frame.name}: ${rows.at(-1)!.ok ? 'pass' : 'FAIL'}`);
  }

  const table = formatReport(rows);
  log(`\n${table}\n\ncost recorded: $${ledger.total(filmId).toFixed(4)}`);
  const out = nextDir(join('debug', 's05'));
  writeFileSync(join(out, 'report.json'), JSON.stringify({ rows, costUsd: ledger.total(filmId) }, null, 2));
  writeFileSync(join(out, 'verdicts.md'), `${table}\n\n${verdicts.join('\n')}`);
  log(`written to ${out}`);
};
