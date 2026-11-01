// Owned by S16b. The film's cast list: who and what the toy studio has made, or is making, for the shots. Kept on FilmState.cast.
import type { CastMember, FilmState } from '@shared/composition';
import type { FilmStore } from '@shared/ports';

/** Updates to one film's cast run one after another, so two workers finishing together never overwrite each other. */
const chains = new Map<string, Promise<unknown>>();

/** Runs `fn` after every earlier update of this film's cast and clips has finished. */
export function serial<T>(filmId: string, fn: () => Promise<T>): Promise<T> {
  const next = (chains.get(filmId) ?? Promise.resolve()).then(fn, fn);
  chains.set(filmId, next.catch(() => undefined));
  return next;
}

export function updateCast<T>(films: FilmStore, filmId: string, fn: (cast: CastMember[]) => { cast: CastMember[]; data: T }): Promise<T> {
  return serial(filmId, async () => {
    const film = await films.get(filmId);
    const r = fn(structuredClone(film.cast ?? []));
    await films.update(filmId, { cast: r.cast });
    return r.data;
  });
}

/** Adds one clip to the film's clip list (replacing one with the same id), in order with the other updates. */
export function addClip(films: FilmStore, filmId: string, clip: { id: string; name: string; assetId?: string }): Promise<void> {
  return serial(filmId, async () => {
    const film = await films.get(filmId);
    await films.update(filmId, { clips: [...(film.clips ?? []).filter((c) => c.id !== clip.id), clip] });
  });
}

/** The film-wide asset id of a cast member. Prefixed, so it can never equal a scene id (scenes are precomps in the same id space). */
export const castAssetId = (id: string): string => `cast-${id}`;

export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'member';

export function setMember(films: FilmStore, filmId: string, id: string, patch: Partial<CastMember>): Promise<void> {
  return updateCast(films, filmId, (cast) => ({ cast: cast.map((m) => (m.id === id ? { ...m, ...patch } : m)), data: undefined }));
}

export const castOf = (film: FilmState): CastMember[] => film.cast ?? [];

/** Why a shot cannot be blocked yet: every cast member, prop, set and clip it needs, and the first one that is not ready, named. */
export function blockers(film: FilmState, sceneId: string): string[] {
  const scene = film.storyboard?.scenes.find((s) => s.id === sceneId);
  if (!scene) return [`unknown scene ${sceneId}`];
  const cast = castOf(film);
  const out: string[] = [];
  const need = (m: CastMember | undefined, what: string) => {
    if (!m) out.push(`${what} has not been requested`);
    else if (m.status !== 'ready') out.push(`${m.kind} '${m.id}' is ${m.status}${m.error ? ` (${m.error})` : ''}`);
  };
  for (const id of scene.castIds ?? []) need(cast.find((m) => m.id === id && m.kind === 'character'), `character '${id}'`);
  for (const m of cast.filter((m) => m.kind === 'set' || m.kind === 'prop')) if (m.status !== 'ready') need(m, m.id);
  for (const cue of scene.cues ?? []) {
    const clip = cast.find((m) => m.kind === 'motion' && m.name.toLowerCase() === cue.clip.toLowerCase());
    if (!clip && cue.clip.toLowerCase() !== 'idle') out.push(`motion '${cue.clip}' has not been requested`);
    else if (clip) need(clip, `motion '${cue.clip}'`);
  }
  return out;
}
