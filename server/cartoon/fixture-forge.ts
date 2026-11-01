// Owned by S16b. The forge's stand-in until S16a ships: every cast, prop, set and motion job is answered from the engine's fixture models in public/cartoon, with no network.
// A real forge replaces these workers (same job kinds, same cast list); nothing else changes.
import type { Job } from '@shared/crew';
import { newFilmComposition, registerAsset } from '../authoring/api';
import type { Comp } from '../authoring/types';
import type { CrewCtx } from '../crew/showrunner-tools';
import type { WorkerFn } from '../crew/workers';
import { charge } from '../art/events';
import { PRICE } from '../art/prices';
import sharp from 'sharp';
import { propModel, propSrc } from './props';
import { addClip, castAssetId, setMember } from './cast';
import { CAST_CHARACTER, CHARACTER_SRC, resolveClip } from './characters';

/** Library motions of the toy character: the ones that are their own files. */
const MOTION_FILES: Record<string, string> = { walk: 'clip-walk', jump: 'clip-jump' };

const FIXTURES = {
  character: { file: 'toy-character', kind: 'model' as const },
  prop: { file: 'prop-crate', kind: 'model' as const },
  set: { file: 'backdrop', kind: 'image' as const },
};

/** The film's composition, or a new empty one: the showrunner may start casting before it has planned the first scene. */
const compOf = (f: { composition?: unknown; aspect: '16:9' | '9:16' | '1:1'; title?: string; storyboard?: { title?: string; palette?: string[] } }): Comp =>
  (f.composition as Comp | undefined) ?? newFilmComposition({ aspect: f.aspect, title: f.storyboard?.title ?? f.title, palette: f.storyboard?.palette });

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))), { once: true });
  });

/** The cast member a forge job is about: the id is in the job's reason (`member:<id>`). */
async function memberOf(crew: CrewCtx, job: Job) {
  const id = /^member:(.+)$/.exec(job.reason)?.[1];
  const m = ((await crew.films.get(job.filmId)).cast ?? []).find((x) => x.id === id);
  if (!m) throw new Error(`no cast member for ${job.id}`);
  return m;
}

const paintPrompt = (place: string) =>
  `A soft painted children's-book backdrop of ${place}, a toy diorama seen straight on, flat gouache colours, gentle light. The painting fills the whole image edge to edge with no border, no frame and no white margin. The top two thirds is the back wall with its furniture, the bottom third is plain empty floor in one colour. No people, no characters, no text, no logos.`;

/** Paints a set's backdrop with the image model and registers it; null when the model fails, so the fixture backdrop is used instead. */
async function paintBackdrop(crew: CrewCtx, place: string, sceneId?: string): Promise<{ src: string; width: number; height: number; ground: string } | null> {
  try {
    const png = await crew.toolCtx.meta.image.generate(paintPrompt(place), '1536x1024');
    const asset = await crew.toolCtx.assets.put(png, 'image/png', { role: 'plate', ...(sceneId ? { sceneId } : {}), width: 1536, height: 1024 });
    charge(crew.toolCtx, 'muse-image-1.0', '1 image', PRICE.museImageUsd);
    // the floor in front of the cove takes the colour of the painted floor, so the two read as one room
    const { data } = await sharp(png).extract({ left: 300, top: 860, width: 900, height: 120 }).resize(1, 1).raw().toBuffer({ resolveWithObject: true });
    const ground = `#${[...data.subarray(0, 3)].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
    return { src: crew.toolCtx.assets.url(asset.id), width: 1536, height: 1024, ground };
  } catch {
    return null;
  }
}

export function createFixtureForge(o: { delayMs?: number; paint?: boolean } = {}): Record<'cast-character' | 'make-prop' | 'make-set' | 'make-motion', WorkerFn> {
  const delay = () => o.delayMs ?? Number(process.env.DIRECTOR_FAKE_DELAY_MS ?? 400);
  const making: (kind: 'character' | 'prop' | 'set') => WorkerFn = (kind) => async (job, signal, crew) => {
    const m = await memberOf(crew, job);
    await setMember(crew.films, job.filmId, m.id, { status: 'running' });
    await sleep(delay(), signal);
    const fx = FIXTURES[kind];
    const painted = kind === 'set' && o.paint ? await paintBackdrop(crew, m.description.replace(/^a toy-diorama backdrop: /, '')) : null;
    const r = await crew.films.mutate(
      job.filmId,
      (f) => ({
        next: registerAsset(compOf(f), { id: castAssetId(m.id), kind: fx.kind, src: painted?.src ?? (kind === 'prop' ? propSrc(propModel(`${m.name} ${m.description}`)) : kind === 'character' ? CHARACTER_SRC : `/cartoon/${fx.file}.${fx.kind === 'model' ? 'glb' : 'png'}`), ...(fx.kind === 'image' ? { width: painted?.width ?? 1024, height: painted?.height ?? 512 } : {}) }),
        data: null,
      }),
      'director',
      `${job.kind} ${m.id}`,
    );
    if (!r.ok) throw new Error('the asset was refused');
    await setMember(crew.films, job.filmId, m.id, { status: 'ready', assetId: castAssetId(m.id), ...(painted ? { ground: painted.ground } : {}) });
    return { summary: `${m.name}: ${painted ? 'painted backdrop' : `fixture ${kind === 'prop' ? propModel(`${m.name} ${m.description}`) : kind === 'character' ? CAST_CHARACTER : fx.file}`}`, version: r.version, costUsd: painted ? PRICE.museImageUsd : 0, model: 'fixture-forge' };
  };
  return {
    'cast-character': making('character'),
    'make-prop': making('prop'),
    'make-set': making('set'),
    'make-motion': async (job, signal, crew) => {
      const m = await memberOf(crew, job);
      await setMember(crew.films, job.filmId, m.id, { status: 'running' });
      await sleep(delay() / 2, signal);
      if (CAST_CHARACTER === 'toy') {
        const file = MOTION_FILES[m.name.toLowerCase()];
        let version: number | undefined;
        if (file) {
          const r = await crew.films.mutate(job.filmId, (f) => ({ next: registerAsset(compOf(f), { id: castAssetId(m.id), kind: 'model', src: `/cartoon/${file}.glb` }), data: null }), 'director', `make-motion ${m.id}`);
          if (!r.ok) throw new Error('the clip was refused');
          version = r.version;
        }
        await setMember(crew.films, job.filmId, m.id, { status: 'ready', ...(file ? { assetId: castAssetId(m.id) } : {}) });
        // the clip list a cue is checked against
        await addClip(crew.films, job.filmId, { id: m.id, name: m.name, ...(file ? { assetId: castAssetId(m.id) } : {}) });
        return { summary: `${m.name}: ${file ? `clip ${file}` : 'library motion'}`, ...(version ? { version } : {}), costUsd: 0, model: 'fixture-forge' };
      }
      // robot: every motion is a clip inside the character model, cued by that clip's name
      const clip = resolveClip(m.name);
      await setMember(crew.films, job.filmId, m.id, { status: 'ready' });
      await addClip(crew.films, job.filmId, { id: m.id, name: clip });
      return { summary: `${m.name}: character clip ${clip}`, costUsd: 0, model: 'fixture-forge' };
    },
  };
}
