import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { SamObject } from '@shared/ports';
import type { ToolCtx } from '@shared/tools';
import { cutoutSheet, orderPieces } from './cutout-sheet';

const obj = (objectId: string, left: number, top: number, right: number, bottom: number, confidence = 0.9): SamObject => ({ objectId, confidence, bounds: { left, top, right, bottom }, alpha: Buffer.alloc(1) });

describe('orderPieces', () => {
  it('reads a row left to right whatever order SAM answers in', () => {
    const r = orderPieces([obj('c', 600, 100, 700, 200), obj('a', 100, 110, 200, 210), obj('b', 350, 95, 450, 195)], { max: 6 });
    expect(r.map((x) => x.objectId)).toEqual(['a', 'b', 'c']);
  });
  it('reads rows top to bottom, then left to right', () => {
    const r = orderPieces([obj('d', 400, 400, 500, 500), obj('b', 400, 100, 500, 200), obj('a', 100, 100, 200, 200), obj('c', 100, 400, 200, 500)], { max: 6 });
    expect(r.map((x) => x.objectId)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('drops low confidence and specks, and keeps the biggest max', () => {
    const r = orderPieces([obj('big1', 0, 0, 100, 100), obj('big2', 200, 0, 300, 100), obj('big3', 400, 0, 500, 100), obj('dust', 600, 0, 605, 5), obj('weak', 700, 0, 800, 100, 0.2)], { max: 2 });
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.objectId)).not.toContain('dust');
    expect(r.map((x) => x.objectId)).not.toContain('weak');
  });
});

describe('cutoutSheet', () => {
  const W = 400;
  const H = 100;
  const alphaFor = (x0: number, x1: number) => {
    const a = Buffer.alloc(W * H);
    for (let y = 20; y < 80; y++) for (let x = x0; x < x1; x++) a[y * W + x] = 255;
    return a;
  };
  it('cuts each piece out of one picture with one SAM call and one charge', async () => {
    const source = await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const segmentImage = vi.fn(async () => [
      { objectId: 'r', confidence: 0.9, bounds: { left: 250, top: 20, right: 350, bottom: 80 }, alpha: alphaFor(250, 350) },
      { objectId: 'l', confidence: 0.9, bounds: { left: 50, top: 20, right: 150, bottom: 80 }, alpha: alphaFor(50, 150) },
    ]);
    const put = vi.fn(async (_b: Buffer, _m: string, meta: object) => ({ id: `ast_${put.mock.calls.length}`, ...meta }));
    const ledger = { add: vi.fn() };
    const ctx = { filmId: 'f', ledger, emit: vi.fn(), meta: { sam: { segmentImage } }, assets: { put } } as unknown as ToolCtx;
    const pieces = await cutoutSheet(ctx, { source, noun: 'splash', max: 4 });
    expect(segmentImage).toHaveBeenCalledTimes(1);
    expect(ledger.add).toHaveBeenCalledTimes(1);
    expect(pieces).toHaveLength(2);
    expect(pieces.map((p) => p.asset.id)).toEqual(['ast_1', 'ast_2']);
    expect(pieces[0]!.width).toBeGreaterThan(80);
    expect(pieces[0]!.height).toBeGreaterThan(40);
  });
  it('throws when SAM finds nothing', async () => {
    const source = await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const ctx = { filmId: 'f', ledger: { add: vi.fn() }, emit: vi.fn(), meta: { sam: { segmentImage: vi.fn(async () => []) } }, assets: {} } as unknown as ToolCtx;
    await expect(cutoutSheet(ctx, { source, noun: 'splash', max: 4 })).rejects.toThrow(/no splash found/);
  });
});

describe('white-key fallback', () => {
  it('splits a white sheet at its empty columns, left to right, dropping dust', async () => {
    const { columnPieces, whiteKeyAlpha } = await import('./cutout-sheet');
    const w = 100;
    const h = 40;
    const rgb = new Uint8Array(w * h * 3).fill(255);
    const ink = (x0: number, x1: number, y0: number, y1: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) rgb.fill(40, (y * w + x) * 3, (y * w + x) * 3 + 3);
    };
    ink(5, 25, 5, 35); // stage 1
    ink(40, 55, 10, 30); // stage 2
    ink(70, 95, 2, 38); // stage 3
    ink(60, 61, 20, 21); // a speck, dust
    const boxes = columnPieces(whiteKeyAlpha(rgb, w, h), w, h, 4);
    expect(boxes.map((b) => [b.left, b.right, b.top, b.bottom])).toEqual([[5, 25, 5, 35], [40, 55, 10, 30], [70, 95, 2, 38]]);
    expect(columnPieces(whiteKeyAlpha(rgb, w, h), w, h, 1).map((b) => b.left)).toEqual([70]);
    expect(columnPieces(whiteKeyAlpha(new Uint8Array(w * h * 3).fill(255), w, h), w, h, 3)).toEqual([]);
  });
});
