// Owned by S16b. The toy-studio tools the showrunner adds to its board tools when CARTOON_MODE is on: cast, dress the set, ask for motion, block a shot, light it.
// Order of work: cast + set + motion in parallel, then block the shots, then review. blockShot refuses while anything a shot needs is not ready and says which.
import { z } from 'zod';
import type { CastMember } from '@shared/composition';
import type { ToolDef, ToolResult } from '@shared/tools';
import type { CrewCtx } from '../crew/showrunner-tools';
import { reviseStoryboard } from '../crew/showrunner-tools';
import { StoryboardOpError } from '../crew/storyboard-ops';
import { blockers, setMember, slug, updateCast } from './cast';

const fail = (error: string): ToolResult => ({ ok: false, error });

export function createCartoonTools(crew: CrewCtx): ToolDef[] {
  const defs: ToolDef[] = [];
  const def = <A>(d: ToolDef<A>) => defs.push(d as ToolDef);

  /** Adds the members, dispatches one forge job each, and records the job on the member. */
  async function request(items: Array<{ kind: CastMember['kind']; name: string; description: string; job: 'cast-character' | 'make-prop' | 'make-set' | 'make-motion' }>): Promise<{ members: string[]; jobIds: string[] } | string> {
    const film = await crew.films.get(crew.filmId);
    const have = new Set((film.cast ?? []).map((m) => m.id));
    const fresh = items.map((i) => ({ ...i, id: slug(i.name) })).filter((i) => !have.has(i.id));
    const members: string[] = [];
    const jobIds: string[] = [];
    for (const i of fresh) {
      // the member exists before its job can start, so the worker always finds it (it reads the member id from the job's reason)
      await updateCast(crew.films, crew.filmId, (cast) => ({ cast: [...cast, { id: i.id, kind: i.kind, name: i.name, description: i.description, status: 'queued' }], data: null }));
      const job = await crew.scheduler.dispatch({ kind: i.job, origin: 'showrunner', brief: i.description.slice(0, 600), reason: `member:${i.id}` });
      jobIds.push(job.id);
      members.push(i.id);
      await setMember(crew.films, crew.filmId, i.id, { jobId: job.id });
    }
    return { members: members.length ? members : items.map((i) => slug(i.name)), jobIds };
  }

  def({
    name: 'castCharacter',
    description: 'Make one character for the film (at most 3 on a stage). The id you get back is what a scene lists in castIds. Runs in parallel with the set and the motions.',
    params: z.object({ name: z.string().min(1).max(40), description: z.string().min(1).max(300) }).strict(),
    async run(_ctx, a) {
      const film = await crew.films.get(crew.filmId);
      if ((film.cast ?? []).filter((m) => m.kind === 'character').length >= 3) return fail('a film has at most 3 characters');
      const r = await request([{ kind: 'character', name: a.name, description: a.description, job: 'cast-character' }]);
      return typeof r === 'string' ? fail(r) : { ok: true, data: { memberId: r.members[0], jobIds: r.jobIds } };
    },
  });

  def({
    name: 'dressSet',
    description: 'Make a set: a painted backdrop for one place, plus up to 4 props. Call it once per place the film visits. Props are things like a crate or a lamp, not characters.',
    params: z.object({ place: z.string().min(1).max(80), props: z.array(z.string().min(1).max(40)).max(4).default([]) }).strict(),
    async run(_ctx, a) {
      const r = await request([
        { kind: 'set', name: a.place, description: `a toy-diorama backdrop: ${a.place}`, job: 'make-set' },
        ...(a.props ?? []).map((p) => ({ kind: 'prop' as const, name: p, description: p, job: 'make-prop' as const })),
      ]);
      return typeof r === 'string' ? fail(r) : { ok: true, data: { memberIds: r.members, jobIds: r.jobIds } };
    },
  });

  def({
    name: 'requestMotion',
    description: "Get a motion the cast can play, by name (wave, walk, jump, ...). 'library' takes it from the clip library; 'act' makes it from a video the user acts out.",
    params: z.object({ name: z.string().min(1).max(40), from: z.enum(['library', 'act']).default('library') }).strict(),
    async run(_ctx, a) {
      const r = await request([{ kind: 'motion', name: a.name, description: `${a.from}: ${a.name}`, job: 'make-motion' }]);
      return typeof r === 'string' ? fail(r) : { ok: true, data: { memberId: r.members[0], jobIds: r.jobIds } };
    },
  });

  def({
    name: 'blockShot',
    description: 'Stage one scene: the blocker places the cast, cues the motions and lights it, from the scene beats and cues. Refused while a character, prop or motion it needs is not ready.',
    params: z.object({ sceneId: z.string().min(1), notes: z.string().max(300).optional() }).strict(),
    async run(_ctx, a) {
      const film = await crew.films.get(crew.filmId);
      const why = blockers(film, a.sceneId);
      if (why.length) return fail(`scene ${a.sceneId} is not ready to block: ${why.join('; ')}`);
      const scene = film.storyboard!.scenes.find((s) => s.id === a.sceneId)!;
      const job = await crew.scheduler.dispatch({ kind: 'block-shot', sceneId: a.sceneId, origin: 'showrunner', brief: a.notes ?? scene.beats ?? scene.intent, reason: 'block the shot' });
      crew.turn.dispatched.add(a.sceneId);
      return { ok: true, data: { jobIds: [job.id] } };
    },
  });

  def({
    name: 'lightCue',
    description: "Set a scene's mood for the blocker: dawn, studio, spotlight or night. Do it before blockShot.",
    params: z.object({ sceneId: z.string().min(1), cue: z.enum(['dawn', 'studio', 'spotlight', 'night']) }).strict(),
    async run(_ctx, a) {
      try {
        await reviseStoryboard(crew, [{ op: 'update', sceneId: a.sceneId, patch: { lightCue: a.cue } }]);
        return { ok: true };
      } catch (e) {
        return fail(e instanceof StoryboardOpError ? e.message : `could not set the light: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  });

  return defs;
}
