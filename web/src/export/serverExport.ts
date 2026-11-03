// Owned by E1. The server path of the MP4 export, for browsers without WebCodecs H.264: upload one JPEG per frame, let the server's ffmpeg
// encode them, and read back the MP4 with the server's own check of it.
import { PASSCODE_HEADER, type ExportStartResponse } from '@shared/api';
import { captureFrames } from './frameExport';
import type { RecordOptions } from './recordCanvas';
import { ExportError, type ExportDriver } from './types';

const IN_FLIGHT = 4;
export const NO_FFMPEG_MESSAGE = 'This server has no ffmpeg, so it cannot build an MP4 for this browser.';
export const BUSY_MESSAGE = 'The server is busy with another export. Try again in a minute.';

function passcodeHeader(): Record<string, string> {
  try {
    const p = localStorage.getItem('director.passcode');
    return p ? { [PASSCODE_HEADER]: p } : {};
  } catch {
    return {};
  }
}

export function toJpeg(canvas: HTMLCanvasElement, quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new ExportError('no-canvas', 'The canvas could not be read.'))), 'image/jpeg', quality));
}

type Fetch = typeof fetch;

async function failFrom(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (res.status === 503 && body.error === 'ffmpeg_missing') throw new ExportError('unsupported', NO_FFMPEG_MESSAGE);
  if (res.status === 429) throw new ExportError('recorder-error', BUSY_MESSAGE);
  throw new ExportError('recorder-error', body.message ?? `The server export failed (${res.status}).`);
}

export interface ServerExportOptions {
  canvas: HTMLCanvasElement;
  driver: ExportDriver;
  durationSec: number;
  fps?: number;
  onProgress?: RecordOptions['onProgress'];
  signal?: AbortSignal;
}

export async function exportMp4ViaServer(
  o: ServerExportOptions,
  deps: { fetch?: Fetch; settle?: () => Promise<void>; toJpeg?: (c: HTMLCanvasElement) => Promise<Blob> } = {},
): Promise<{ blob: Blob; problems: string[] }> {
  const doFetch = deps.fetch ?? fetch.bind(globalThis);
  const jpeg = deps.toJpeg ?? toJpeg;
  const fps = o.fps ?? 30;
  const frames = Math.ceil(o.durationSec * fps);
  const headers = passcodeHeader();

  const start = await doFetch('/api/exports', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ fps, frames, width: o.canvas.width, height: o.canvas.height }),
  });
  if (!start.ok) await failFrom(start);
  const { id } = (await start.json()) as ExportStartResponse;

  const pending = new Set<Promise<void>>();
  let failure: unknown;
  let uploaded = 0;
  const out = o.driver.blurAt && typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: o.canvas.width, height: o.canvas.height }) : undefined;
  await captureFrames(
    {
      driver: o.driver,
      durationSec: o.durationSec,
      fps,
      signal: o.signal,
      onProgress: undefined,
      ...(out ? { canvas: o.canvas, out } : {}),
      onFrame: async (i) => {
        if (failure) throw failure;
        const body = await jpeg(out ?? o.canvas); // read now: the next seek overwrites the canvas
        const p: Promise<void> = doFetch(`/api/exports/${id}/frames/${i}`, { method: 'PUT', headers: { ...headers, 'content-type': 'image/jpeg' }, body })
          .then(async (res) => {
            if (!res.ok) await failFrom(res);
            uploaded++;
            o.onProgress?.({ timeSec: i / fps, fraction: uploaded / frames });
          })
          .catch((e) => void (failure ??= e))
          .finally(() => void pending.delete(p));
        pending.add(p);
        if (pending.size >= IN_FLIGHT) await Promise.race(pending);
      },
    },
    { settle: deps.settle },
  );
  await Promise.all(pending);
  if (failure) throw failure;

  const done = await doFetch(`/api/exports/${id}/finish`, { method: 'POST', headers });
  if (!done.ok) await failFrom(done);
  let problems: string[] = [];
  try {
    problems = JSON.parse(done.headers.get('x-export-problems') ?? '[]') as string[];
  } catch {
    problems = [];
  }
  return { blob: new Blob([await done.arrayBuffer()], { type: 'video/mp4' }), problems };
}

/** The server's check of an MP4 the browser built. A server without ffmpeg answers 503: then there is simply nothing to report. */
export async function checkMp4OnServer(
  blob: Blob,
  expect: { durationSec: number; fps: number; width: number; height: number },
  deps: { fetch?: Fetch } = {},
): Promise<string[]> {
  const doFetch = deps.fetch ?? fetch.bind(globalThis);
  try {
    const q = new URLSearchParams(Object.entries(expect).map(([k, v]) => [k, String(v)]));
    const res = await doFetch(`/api/exports/check?${q}`, { method: 'POST', headers: { ...passcodeHeader(), 'content-type': 'video/mp4' }, body: blob });
    if (!res.ok) return [];
    return ((await res.json()) as { problems: string[] }).problems;
  } catch {
    return [];
  }
}
