import { Buffer } from 'node:buffer';
import { decodeMaskToRaster, frameIndexOf, parseImageStream, parseVideoStream, recordsOfKind } from '@meta-sam/parser';
import type { MetaClients, SamObject } from '@shared/ports';
import type { MetaHttp } from './http';
import { dataUrl, sniffImageMime } from './mime';

type SseEvent = { type: string; [k: string]: unknown };

/** Split SSE text into events (blank-line separated) and JSON.parse each `data:` line; a truncated tail is skipped. */
function sseEvents(text: string): SseEvent[] {
  const out: SseEvent[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    for (const line of block.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      try {
        const ev = JSON.parse(line.slice(5).trim()) as SseEvent;
        if (ev && typeof ev.type === 'string') out.push(ev);
      } catch {
        // a cut-off final line is expected
      }
    }
  }
  return out;
}

async function* iterate(events: SseEvent[]): AsyncGenerator<SseEvent> {
  for (const e of events) yield e;
}

/**
 * Frame size: `@meta-sam/parser` does not expose it on any record (`SegmentationMaskRecord` carries only the
 * box as `bounds`, and `frame` holds just `frameIndex`). It is in the raw box token, `w=<frameW>;h=<frameH>`,
 * which the parser returns verbatim in `result.rawOutput`; we read the first such pair.
 */
function frameSizeOf(rawOutput: string): { width: number; height: number } | undefined {
  const m = /<\|box;[^|]*?;w=(\d+);h=(\d+)/.exec(rawOutput);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined;
}

export async function parseSamImageEvents(sseText: string): Promise<SamObject[]> {
  const result = await parseImageStream(iterate(sseEvents(sseText))).finalResult;
  const frame = frameSizeOf(result.rawOutput);
  if (!frame) return [];

  // keep only the newest revision of each mask identity
  const latest = new Map<string, ReturnType<typeof recordsOfKind<'mask'>>[number]>();
  for (const rec of recordsOfKind(result.records, 'mask')) {
    const prev = latest.get(rec.identity);
    if (!prev || rec.revision >= prev.revision) latest.set(rec.identity, rec);
  }

  const objects: SamObject[] = [];
  for (const rec of latest.values()) {
    const { left, top, right, bottom } = rec.bounds;
    const boxW = right - left;
    const boxH = bottom - top;
    const raster = decodeMaskToRaster(rec.mask); // row-major 0/1, length H*W
    const { width: rw, height: rh } = rec.mask;
    const alpha = Buffer.alloc(frame.width * frame.height);
    for (let y = 0; y < boxH; y++) {
      const fy = top + y;
      if (fy < 0 || fy >= frame.height) continue;
      const sy = Math.min(rh - 1, Math.floor((y * rh) / boxH));
      for (let x = 0; x < boxW; x++) {
        const fx = left + x;
        if (fx < 0 || fx >= frame.width) continue;
        const sx = Math.min(rw - 1, Math.floor((x * rw) / boxW));
        if (raster[sy * rw + sx]) alpha[fy * frame.width + fx] = 255;
      }
    }
    objects.push({ objectId: rec.objectId, bounds: { left, top, right, bottom }, alpha, ...(rec.confidence !== undefined ? { confidence: rec.confidence } : {}) });
  }
  const area = (o: SamObject) => (o.bounds.right - o.bounds.left) * (o.bounds.bottom - o.bounds.top);
  return objects.sort((a, b) => area(b) - area(a));
}

export async function parseSamVideoEvents(sseText: string): Promise<{ frames: number; framesWithObject: number[]; objectIds: string[] }> {
  const events = sseEvents(sseText);
  // An EOF without response.completed is an `incomplete` outcome, not an error.
  const result = await parseVideoStream(iterate(events)).finalResult;
  const boxes = recordsOfKind(result.records, 'box');
  const framesWithObject = [...new Set(boxes.map(frameIndexOf).filter((n): n is number => n !== undefined))].sort((a, b) => a - b);
  const objectIds = [...new Set(boxes.map((b) => b.objectId))];
  const completed = events.find((e) => e.type === 'response.completed') as { response?: { usage?: { video_frames_processed?: number } } } | undefined;
  const processed = completed?.response?.usage?.video_frames_processed;
  const frames = processed ?? (framesWithObject.length ? framesWithObject[framesWithObject.length - 1]! + 1 : 0);
  return { frames, framesWithObject, objectIds };
}

export function createSamClient(http: MetaHttp): MetaClients['sam'] {
  const request = (part: Record<string, unknown>, noun: string, metadata: Record<string, string>) => ({
    model: 'sam-3.1',
    stream: true,
    input: [{ role: 'user', content: [{ type: 'input_text', text: noun }, part] }],
    metadata,
  });
  return {
    async segmentImage(img, noun) {
      const body = request({ type: 'input_image', image_url: dataUrl(img, sniffImageMime(img)) }, noun, { include_confidence: 'true' });
      return parseSamImageEvents((await http.sse('/responses', body)).text);
    },
    async trackVideo(mp4, noun) {
      const body = request({ type: 'input_video', video_url: dataUrl(mp4, 'video/mp4') }, noun, { include_confidence: 'true', mask_encoding: 'one_bit' });
      return parseSamVideoEvents((await http.sse('/responses', body)).text);
    },
  };
}
