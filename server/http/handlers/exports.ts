// Owned by E1. Server-side MP4 export for browsers without WebCodecs H.264: the page uploads one JPEG per frame, ffmpeg encodes them,
// and the MP4 comes back checked. Also checks an MP4 the browser built itself. Sessions live only in a temp dir and never touch DATA_DIR.
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { AppDeps } from '../deps';
import { encodeFrames, frameName } from '../../media/encode';
import { checkExport, type ExportExpect } from '../../media/export-check';
import { hasFfmpeg } from '../../media/ffmpeg';

const MAX_OPEN = 2;
const IDLE_MS = 10 * 60_000;
const FRAME_MAX_MB = 4;
const VIDEO_MAX_MB = 200;

const startSchema = z.object({
  fps: z.number().min(1).max(60),
  frames: z.number().int().min(1).max(1800),
  width: z.number().int().min(16).max(2160),
  height: z.number().int().min(16).max(2160),
});

interface Session {
  dir: string;
  fps: number;
  frames: number;
  width: number;
  height: number;
  got: Set<number>;
  touched: number;
}

export interface ExportRouteOptions {
  encode?: typeof encodeFrames;
  check?: typeof checkExport;
  hasFfmpeg?: () => Promise<boolean>;
  now?: () => number;
  tmpRoot?: string;
}

export function registerExportRoutes(app: Hono, _deps: AppDeps, opts: ExportRouteOptions = {}): void {
  const encode = opts.encode ?? encodeFrames;
  const check = opts.check ?? checkExport;
  const ffmpegOk = opts.hasFfmpeg ?? hasFfmpeg;
  const now = opts.now ?? Date.now;
  const root = opts.tmpRoot ?? tmpdir();
  const sessions = new Map<string, Session>();

  const drop = async (id: string) => {
    const s = sessions.get(id);
    sessions.delete(id);
    if (s) await rm(s.dir, { recursive: true, force: true });
  };
  const sweep = async () => {
    for (const [id, s] of sessions) if (now() - s.touched > IDLE_MS) await drop(id);
  };

  // every export route first checks ffmpeg and sweeps idle sessions
  app.use('/api/exports/*', async (c, next) => {
    if (!(await ffmpegOk())) return c.json({ error: 'ffmpeg_missing' }, 503);
    await sweep();
    await next();
  });

  app.post('/api/exports', async (c) => {
    const body = startSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_body' }, 400);
    if (sessions.size >= MAX_OPEN) return c.json({ error: 'busy' }, 429);
    const id = randomUUID();
    await mkdir(root, { recursive: true });
    const dir = await mkdtemp(join(root, 'export-'));
    sessions.set(id, { dir, ...body.data, got: new Set(), touched: now() });
    return c.json({ id }, 201);
  });

  app.put(
    '/api/exports/:id/frames/:i',
    bodyLimit({ maxSize: FRAME_MAX_MB * 1024 * 1024, onError: (c) => c.json({ error: 'payload_too_large', maxMb: FRAME_MAX_MB }, 413) }),
    async (c) => {
      const s = sessions.get(c.req.param('id'));
      if (!s) return c.json({ error: 'no_such_export' }, 404);
      const i = Number(c.req.param('i'));
      if (!Number.isInteger(i) || i < 0 || i >= s.frames) return c.json({ error: 'bad_frame_index' }, 400);
      await writeFile(join(s.dir, frameName(i)), Buffer.from(await c.req.arrayBuffer()));
      s.got.add(i);
      s.touched = now();
      return c.body(null, 204);
    },
  );

  app.post('/api/exports/:id/finish', async (c) => {
    const id = c.req.param('id');
    const s = sessions.get(id);
    if (!s) return c.json({ error: 'no_such_export' }, 404);
    const missing = Array.from({ length: s.frames }, (_, i) => i).filter((i) => !s.got.has(i));
    if (missing.length) return c.json({ error: 'missing_frames', missing: missing.slice(0, 20) }, 409);
    try {
      const out = join(s.dir, 'out.mp4');
      await encode({ framesDir: s.dir, fps: s.fps, out });
      const video = await readFile(out);
      const expect: ExportExpect = { durationSec: s.frames / s.fps, fps: s.fps, width: s.width, height: s.height };
      const problems = await check(video, expect);
      return new Response(new Uint8Array(video), {
        status: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': String(video.length), 'x-export-problems': JSON.stringify(problems) },
      });
    } catch (e) {
      return c.json({ error: 'encode_failed', message: e instanceof Error ? e.message : String(e) }, 500);
    } finally {
      await drop(id);
    }
  });

  app.post(
    '/api/exports/check',
    bodyLimit({ maxSize: VIDEO_MAX_MB * 1024 * 1024, onError: (c) => c.json({ error: 'payload_too_large', maxMb: VIDEO_MAX_MB }, 413) }),
    async (c) => {
      const q = z.object({ durationSec: z.coerce.number().positive(), fps: z.coerce.number().positive(), width: z.coerce.number().positive(), height: z.coerce.number().positive() }).safeParse(c.req.query());
      if (!q.success) return c.json({ error: 'invalid_query' }, 400);
      const problems = await check(Buffer.from(await c.req.arrayBuffer()), q.data);
      return c.json({ problems });
    },
  );
}
