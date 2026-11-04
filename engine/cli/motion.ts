import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { applyEdit, undoEdit } from '../src/agent/edit';
import type { EditOp, Receipt } from '../src/agent/edit';
import { bakeDoc } from '../src/qa/bake';
import { qaDoc } from '../src/qa/qa';
import { EFFECTS } from '../src/effects/table';
import { PRESET_NAMES } from '../src/schema/enums';
import { explainDoc } from '../src/schema/explain';
import { CAMERA_PROPS, LAYER_PROPS, LIGHT_PROPS, OBJECT_PROPS } from '../src/timeline/targets';

// One JSON object on stdout per call. Exit codes: 0 ok, 1 doc or QA error, 2 usage, 6 stale.

class Usage extends Error {}

type Json = Record<string, unknown>;
interface Out {
  code: number;
  body: Json;
}

const out = (body: Json, code = 0): Out => ({ code, body });
const usage = (message: string): never => {
  throw new Usage(message);
};

function parseArgs(argv: string[]): { pos: string[]; flags: Record<string, string> } {
  const pos: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) usage(`flag ${a} needs a value`);
      flags[a.slice(2)] = value;
      i += 1;
    } else pos.push(a);
  }
  return { pos, flags };
}

function readJson(path: string): unknown {
  if (!existsSync(path)) usage(`file not found: ${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return usage(`not valid JSON: ${path} (${(error as Error).message})`);
  }
}

function expectRevision(flags: Record<string, string>): number {
  const raw = flags['expect-revision'];
  if (raw === undefined) return usage('--expect-revision N is required');
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) usage('--expect-revision must be a non-negative integer');
  return n;
}

const journalPath = (doc: string): string => `${doc}.receipts.jsonl`;

function readJournal(doc: string): Receipt[] {
  const path = journalPath(doc);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Receipt);
}

function editResult(path: string, result: ReturnType<typeof applyEdit>): Out {
  if (!result.ok) return out({ ok: false, error: result.error }, result.error.code === 'STALE_DOC' ? 6 : 1);
  writeFileSync(path, `${JSON.stringify(result.doc, null, 2)}\n`);
  appendFileSync(journalPath(path), `${JSON.stringify(result.receipt)}\n`);
  return out({ ok: true, receipt: result.receipt });
}

function targets(type: string | undefined): Out {
  if (!type) return usage('targets <layerType> (image|text|shape|group|three|camera|object|light)');
  const table: Record<string, readonly string[]> = { ...LAYER_PROPS, camera: CAMERA_PROPS, object: OBJECT_PROPS, light: LIGHT_PROPS };
  const props = table[type];
  if (!props) return usage(`unknown layer type "${type}"; use one of ${Object.keys(table).join(', ')}`);
  return out({ ok: true, type, properties: [...props] });
}

function run(argv: string[]): Out {
  const [cmd, ...rest] = argv;
  const { pos, flags } = parseArgs(rest);
  switch (cmd) {
    case 'explain': {
      if (!pos[0]) usage('explain <doc.json>');
      const result = explainDoc(readJson(pos[0]));
      return out({ ok: result.ok, errors: result.errors }, result.ok ? 0 : 1);
    }
    case 'qa': {
      if (!pos[0]) usage('qa <doc.json> [--frames a:b]');
      const parsed = explainDoc(readJson(pos[0]));
      if (!parsed.ok) return out({ ok: false, errors: parsed.errors }, 1);
      let baked = bakeDoc(parsed.doc);
      if (flags.frames !== undefined) {
        const m = /^(\d+):(\d+)$/.exec(flags.frames);
        if (!m || Number(m[1]) > Number(m[2])) usage('--frames must look like a:b with a <= b');
        const [lo, hi] = [Number(m![1]), Number(m![2])];
        baked = { ...baked, layers: baked.layers.map((l) => ({ ...l, frames: l.frames.filter((f) => f.frame >= lo && f.frame <= hi) })) };
      }
      const report = qaDoc(parsed.doc, baked);
      return out({ ...report }, report.ok ? 0 : 1);
    }
    case 'edit': {
      if (!pos[0] || !flags.ops) usage('edit <doc.json> --ops <ops.json> --expect-revision N');
      const doc = readJson(pos[0]) as Record<string, unknown>;
      const ops = readJson(flags.ops) as EditOp[];
      if (!Array.isArray(ops)) usage('--ops file must hold a JSON array of ops');
      return editResult(pos[0], applyEdit(doc, ops, { expectRevision: expectRevision(flags) }));
    }
    case 'undo': {
      if (!pos[0] || !flags.receipt) usage('undo <doc.json> --receipt <id> --expect-revision N');
      const receipt = readJournal(pos[0]).find((r) => r.id === flags.receipt);
      if (!receipt) return out({ ok: false, error: { code: 'NOT_FOUND', message: `no receipt ${flags.receipt} in ${journalPath(pos[0])}`, recovery: 'use an id printed by edit' } }, 1);
      const doc = readJson(pos[0]) as Record<string, unknown>;
      return editResult(pos[0], undoEdit(doc, receipt, { expectRevision: expectRevision(flags) }));
    }
    case 'presets':
      return out({ ok: true, presets: PRESET_NAMES.map((p) => ({ name: p.name, kind: p.kind })) });
    case 'effects':
      return out({
        ok: true,
        effects: Object.entries(EFFECTS).map(([type, def]) => ({
          type,
          scope: def?.scope,
          defaults: def?.defaults ?? {},
          tweenable: Object.keys(def?.tweenable ?? {}),
        })),
      });
    case 'targets':
      return targets(pos[0]);
    default:
      return usage(`unknown command "${cmd ?? ''}"; use explain, qa, edit, undo, presets, effects, targets`);
  }
}

function main(): void {
  let result: Out;
  try {
    result = run(process.argv.slice(2));
  } catch (error) {
    if (error instanceof Usage) result = out({ ok: false, error: { code: 'USAGE', message: error.message } }, 2);
    else result = out({ ok: false, error: { code: 'INTERNAL', message: (error as Error).message } }, 1);
  }
  process.stdout.write(`${JSON.stringify(result.body)}\n`);
  process.exitCode = result.code;
}

main();
