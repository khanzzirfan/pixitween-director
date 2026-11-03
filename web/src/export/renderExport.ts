// The page's side of a server-built export: start the job, poll its progress, fetch the finished MP4 as a blob (so the passcode header goes with it).
import { PASSCODE_HEADER } from '@shared/api';

export type ExportQuality = 'draft' | 'full';
export type ExportJobStatus = 'rendering' | 'encoding' | 'done' | 'error' | 'cancelled';

export interface ExportJobView {
  id: string;
  filmId: string;
  status: ExportJobStatus;
  quality: ExportQuality;
  frame: number;
  frames: number;
  progress: number;
  problems: string[];
  error?: string;
  bytes?: number;
  fileName?: string;
}

export class RenderExportError extends Error {}

function headers(): Record<string, string> {
  try {
    const p = localStorage.getItem('director.passcode');
    return p ? { [PASSCODE_HEADER]: p } : {};
  } catch {
    return {};
  }
}

async function fail(res: Response): Promise<never> {
  const b = (await res.json().catch(() => ({}))) as { message?: string };
  throw new RenderExportError(b.message ?? `The export failed (${res.status}).`);
}

export async function renderExportAvailable(f: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await f('/api/render-exports/capability', { headers: headers() });
    return res.ok && ((await res.json()) as { available?: boolean }).available === true;
  } catch {
    return false;
  }
}

export async function startRenderExport(filmId: string, quality: ExportQuality, f: typeof fetch = fetch): Promise<ExportJobView> {
  const res = await f(`/api/films/${filmId}/render-exports`, { method: 'POST', headers: { ...headers(), 'content-type': 'application/json' }, body: JSON.stringify({ quality }) });
  if (!res.ok) await fail(res);
  return (await res.json()) as ExportJobView;
}

export async function getRenderExport(id: string, f: typeof fetch = fetch): Promise<ExportJobView> {
  const res = await f(`/api/render-exports/${id}`, { headers: headers() });
  if (!res.ok) await fail(res);
  return (await res.json()) as ExportJobView;
}

export async function cancelRenderExport(id: string, f: typeof fetch = fetch): Promise<void> {
  await f(`/api/render-exports/${id}`, { method: 'DELETE', headers: headers() }).catch(() => undefined);
}

export async function downloadRenderExport(id: string, f: typeof fetch = fetch): Promise<Blob> {
  const res = await f(`/api/render-exports/${id}/download`, { headers: headers() });
  if (!res.ok) await fail(res);
  return res.blob();
}

/** Polls until the job leaves rendering/encoding. Reports each view; gives up on a lost server after a few failed polls. */
export async function pollRenderExport(
  id: string,
  o: { onView(v: ExportJobView): void; signal?: AbortSignal; intervalMs?: number; fetch?: typeof fetch },
): Promise<ExportJobView> {
  const every = o.intervalMs ?? 700;
  let misses = 0;
  for (;;) {
    if (o.signal?.aborted) throw new RenderExportError('Export cancelled');
    try {
      const v = await getRenderExport(id, o.fetch);
      misses = 0;
      o.onView(v);
      if (v.status !== 'rendering' && v.status !== 'encoding') return v;
    } catch (e) {
      if (++misses >= 5) throw e instanceof Error ? e : new RenderExportError('Lost contact with the server.');
    }
    await new Promise((r) => setTimeout(r, every));
  }
}
