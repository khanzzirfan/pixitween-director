// Owned by S12a. Pure storyboard edits for the crew (design.md 5.4): scene ids stay stable, and every op says what became dirty.
import { storyboardOpSchema, type StoryboardOp } from '@shared/crew';
import { MAX_GENERATE_SCENES, storyboardSchema, type Scene, type Storyboard } from '@shared/storyboard';

export type DirtyKind = 'rebuild' | 'camera' | 'text' | 'duration' | 'mode';

export interface OpsResult {
  storyboard: Storyboard;
  dirty: Record<string, DirtyKind[]>;
  added: string[];
  removed: string[];
}

export class StoryboardOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoryboardOpError';
  }
}

const idNumber = (id: string): number => {
  const m = /^s(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
};

/** `s<max + 1>` over the scenes in the storyboard and the ids removed from it, so an id is never reused. */
export function nextSceneId(storyboard: Pick<Storyboard, 'scenes'>, removedIds: readonly string[] = []): string {
  const max = Math.max(0, ...storyboard.scenes.map((s) => idNumber(s.id)), ...removedIds.map(idNumber));
  return `s${max + 1}`;
}

const PATCH_DIRT: Partial<Record<keyof Scene, DirtyKind>> = {
  durationSec: 'duration',
  camera: 'camera',
  text: 'text',
  mode: 'mode',
  intent: 'rebuild',
  shotType: 'rebuild',
  layersWanted: 'rebuild',
};

/**
 * Applies a batch of ops to a copy of the storyboard. The batch is all or nothing: any failure throws
 * StoryboardOpError and nothing is applied. `previouslyRemoved` carries ids removed in earlier batches.
 */
export function applyOps(storyboard: Storyboard, ops: readonly StoryboardOp[], previouslyRemoved: readonly string[] = []): OpsResult {
  const parsedOps = storyboardOpSchema.array().safeParse(ops);
  if (!parsedOps.success) throw new StoryboardOpError(parsedOps.error.message);

  const scenes: Scene[] = structuredClone(storyboard.scenes);
  const dirty = new Map<string, Set<DirtyKind>>();
  const added: string[] = [];
  const removed: string[] = [];
  const mark = (id: string, kind: DirtyKind) => (dirty.get(id) ?? dirty.set(id, new Set()).get(id)!).add(kind);
  const indexOf = (id: string): number => {
    const i = scenes.findIndex((s) => s.id === id);
    if (i === -1) throw new StoryboardOpError(`no scene '${id}'`);
    return i;
  };
  /** Where a scene goes: after `after` (null = first, undefined = last). */
  const position = (after: string | null | undefined): number => (after === undefined ? scenes.length : after === null ? 0 : indexOf(after) + 1);

  for (const op of parsedOps.data) {
    if (op.op === 'add') {
      const id = op.scene.id ?? nextSceneId({ scenes }, [...previouslyRemoved, ...removed]);
      if (scenes.some((s) => s.id === id)) throw new StoryboardOpError(`scene '${id}' already exists`);
      scenes.splice(position(op.after), 0, { ...op.scene, id } as Scene);
      added.push(id);
      mark(id, 'rebuild');
    } else if (op.op === 'update') {
      const i = indexOf(op.sceneId);
      const patch = Object.fromEntries(Object.entries(op.patch).filter(([, v]) => v !== undefined));
      scenes[i] = { ...scenes[i]!, ...patch } as Scene;
      for (const key of Object.keys(patch)) {
        const kind = PATCH_DIRT[key as keyof Scene];
        if (kind) mark(op.sceneId, kind);
      }
    } else if (op.op === 'remove') {
      scenes.splice(indexOf(op.sceneId), 1);
      removed.push(op.sceneId);
      dirty.delete(op.sceneId);
    } else {
      const [moving] = scenes.splice(indexOf(op.sceneId), 1);
      scenes.splice(position(op.after), 0, moving!);
    }
  }

  // a scene added and removed inside one batch never existed for the caller
  const addedKept = added.filter((id) => scenes.some((s) => s.id === id));
  const removedBefore = removed.filter((id) => storyboard.scenes.some((s) => s.id === id));

  const next = { ...storyboard, scenes, durationSec: scenes.reduce((n, s) => n + s.durationSec, 0) };
  const valid = storyboardSchema.safeParse(next);
  if (!valid.success) throw new StoryboardOpError(valid.error.issues.map((i) => i.message).join('; '));
  if (scenes.filter((s) => s.mode === 'generate').length > MAX_GENERATE_SCENES) throw new StoryboardOpError(`at most ${MAX_GENERATE_SCENES} generate scenes`);

  const out: Record<string, DirtyKind[]> = {};
  for (const [id, kinds] of dirty) {
    // a new scene is built whole from its final state, so the finer kinds add nothing
    out[id] = addedKept.includes(id) ? ['rebuild'] : [...kinds];
  }
  return { storyboard: valid.data, dirty: out, added: addedKept, removed: removedBefore };
}
