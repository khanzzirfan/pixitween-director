// One film export at a time: render the frames, encode the MP4, check it. The job keeps its progress for the page to poll and its
// file in a temp folder until it is downloaded, cancelled or has sat unclaimed for KEEP_MS.
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeFrames } from '../media/encode';
import { checkExport } from '../media/export-check';
import { muxAudio, type AudioItem } from './audio';
import { renderFrames, RenderError } from './render';

export type ExportQuality = 'draft' | 'full';
export type JobStatus = 'rendering' | 'encoding' | 'done' | 'error' | 'cancelled';

export interface ExportJob {
  id: string;
  filmId: string;
  status: JobStatus;
  quality: ExportQuality;
  frame: number;
  frames: number;
  /** 0 to 1 over the whole job: rendering is 90 %, encoding and checking the rest. */
  progress: number;
  problems: string[];
  error?: string;
  bytes?: number;
  fileName?: string;
}

interface Internal extends ExportJob {
  dir: string;
  file?: string;
  ctl: AbortController;
  touched: number;
}

export interface JobDeps {
  render?: typeof renderFrames;
  encode?: typeof encodeFrames;
  check?: typeof checkExport;
  mux?: typeof muxAudio;
  base?: string;
  tmpRoot?: string;
  now?: () => number;
}

const KEEP_MS = 30 * 60_000;
const QUALITY = { draft: { fps: 15, scale: 1 }, full: { fps: 30, scale: 2 } } as const;

export class BusyError extends Error {}

export interface StartInput {
  filmId: string;
  title: string;
  composition: { fps: number; durationInFrames: number; width: number; height: number };
  quality: ExportQuality;
  /** The sound to lay under the picture, and how to read a stored asset. */
  audio?: { items: AudioItem[]; read(assetId: string): Promise<Buffer> };
}

export function createExportJobs(deps: JobDeps = {}) {
  const render = deps.render ?? renderFrames;
  const encode = deps.encode ?? encodeFrames;
  const check = deps.check ?? checkExport;
  const mux = deps.mux ?? muxAudio;
  const base = deps.base ?? process.env.EXPORT_RENDER_BASE ?? `http://localhost:${process.env.DIRECTOR_WEB_PORT ?? 5173}`;
  const root = deps.tmpRoot ?? tmpdir();
  const now = deps.now ?? Date.now;
  const jobs = new Map<string, Internal>();

  const pub = ({ dir: _d, file: _f, ctl: _c, touched: _t, ...rest }: Internal): ExportJob => rest;
  const drop = async (id: string) => {
    const j = jobs.get(id);
    jobs.delete(id);
    if (j) {
      j.ctl.abort();
      await rm(j.dir, { recursive: true, force: true });
    }
  };
  const sweep = async () => {
    for (const [id, j] of jobs) if (j.status !== 'rendering' && j.status !== 'encoding' && now() - j.touched > KEEP_MS) await drop(id);
  };

  async function run(j: Internal, input: StartInput): Promise<void> {
    const q = QUALITY[j.quality];
    try {
      const size = await render({
        composition: input.composition,
        width: input.composition.width,
        height: input.composition.height,
        fps: q.fps,
        frames: j.frames,
        scale: q.scale,
        framesDir: j.dir,
        base,
        signal: j.ctl.signal,
        onFrame: (done) => {
          j.frame = done;
          j.progress = (done / j.frames) * 0.9;
          j.touched = now();
        },
      });
      j.status = 'encoding';
      j.progress = 0.92;
      const out = join(j.dir, 'out.mp4');
      await encode({ framesDir: j.dir, fps: q.fps, out });
      j.progress = 0.97;
      if (j.ctl.signal.aborted) throw new RenderError('aborted', 'Export cancelled');
      const durationSec = j.frames / q.fps;
      let final = out;
      const notes: string[] = [];
      if (input.audio?.items.length) {
        try {
          final = join(j.dir, 'final.mp4');
          const { skipped } = await mux({ dir: j.dir, video: out, out: final, durationSec, items: input.audio.items, read: input.audio.read });
          if (skipped.length) notes.push(`Exported without audio from: ${skipped.join(', ')}`);
        } catch {
          final = out;
          notes.push('Exported without audio');
        }
      }
      j.problems = [...notes, ...(await check(await readFile(final), { durationSec, fps: q.fps, ...size }))];
      j.file = final;
      j.bytes = (await stat(final)).size;
      j.fileName = exportName(input.title, new Date(now()));
      j.progress = 1;
      j.status = 'done';
    } catch (e) {
      if (e instanceof RenderError && e.code === 'aborted') j.status = 'cancelled';
      else {
        j.status = 'error';
        j.error = e instanceof Error ? e.message : String(e);
      }
    } finally {
      j.touched = now();
      if (j.status !== 'done') await rm(j.dir, { recursive: true, force: true });
    }
  }

  return {
    async start(input: StartInput): Promise<ExportJob> {
      await sweep();
      if ([...jobs.values()].some((j) => j.status === 'rendering' || j.status === 'encoding')) throw new BusyError('Another export is running.');
      await mkdir(root, { recursive: true });
      const q = QUALITY[input.quality];
      const frames = Math.ceil((input.composition.durationInFrames / input.composition.fps) * q.fps);
      const j: Internal = {
        id: randomUUID(),
        filmId: input.filmId,
        status: 'rendering',
        quality: input.quality,
        frame: 0,
        frames,
        progress: 0,
        problems: [],
        dir: await mkdtemp(join(root, 'render-')),
        ctl: new AbortController(),
        touched: now(),
      };
      jobs.set(j.id, j);
      void run(j, input);
      return pub(j);
    },
    get: (id: string): ExportJob | undefined => (jobs.get(id) ? pub(jobs.get(id)!) : undefined),
    file: (id: string): { path: string; name: string } | undefined => {
      const j = jobs.get(id);
      return j?.status === 'done' && j.file ? { path: j.file, name: j.fileName! } : undefined;
    },
    cancel: (id: string): boolean => {
      const j = jobs.get(id);
      if (!j) return false;
      if (j.status === 'rendering' || j.status === 'encoding') j.ctl.abort();
      else void drop(id);
      return true;
    },
  };
}

export function exportName(title: string, at: Date): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return `${slug || 'film'}-${at.toISOString().slice(0, 10).replace(/-/g, '')}.mp4`;
}
