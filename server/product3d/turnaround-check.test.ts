import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { ToolCtx } from '@shared/tools';
import { checkTurnaround, parseTurnaroundCheck, turnaroundCheckPrompt } from './turnaround-check';

describe('parseTurnaroundCheck', () => {
  it('reads a problem list', () => {
    expect(parseTurnaroundCheck('{"ok":false,"problems":["the back has a stray lump"]}')).toEqual({ ok: false, problems: ['the back has a stray lump'] });
  });
  it('reads JSON in a fence or with text around it, and an object', () => {
    expect(parseTurnaroundCheck('```json\n{"ok":false,"problems":["x"]}\n```').ok).toBe(false);
    expect(parseTurnaroundCheck('Sure! {"ok":false,"problems":["y"]} done').problems).toEqual(['y']);
    expect(parseTurnaroundCheck({ ok: true, problems: [] })).toEqual({ ok: true, problems: [] });
  });
  it('counts anything unreadable as ok with no problems', () => {
    expect(parseTurnaroundCheck('no json here')).toEqual({ ok: true, problems: [] });
    expect(parseTurnaroundCheck('{broken')).toEqual({ ok: true, problems: [] });
    expect(parseTurnaroundCheck(undefined)).toEqual({ ok: true, problems: [] });
  });
  it('keeps at most 4 problems', () => {
    expect(parseTurnaroundCheck({ ok: false, problems: ['a', 'b', 'c', 'd', 'e'] }).problems).toHaveLength(4);
  });
});

describe('turnaroundCheckPrompt', () => {
  it('names the lock lines only when there are some', () => {
    expect(turnaroundCheckPrompt({ what: 'a bottle' })).not.toContain('must hold');
    expect(turnaroundCheckPrompt({ what: 'a bottle', locks: ['the cap is gold'] })).toContain('"the cap is gold"');
  });
});

describe('checkTurnaround', () => {
  it('makes one look at the photo then the sheet and adds one ledger line of 0.005', async () => {
    const seen: Buffer[][] = [];
    const adds: number[] = [];
    const ctx = {
      filmId: 'f1',
      meta: { spark: { reviewImages: async (images: Buffer[]) => { seen.push(images); return '{"ok":true,"problems":[]}'; } } },
      ledger: { add: (_f: string, _m: string, _u: string, usd: number) => adds.push(usd) },
    } as unknown as ToolCtx;
    const photo = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#cc3355' } }).png().toBuffer();
    const sheet = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: '#ffffff' } }).png().toBuffer();
    expect(await checkTurnaround(ctx, { photo, sheet, what: 'a bottle' })).toEqual({ ok: true, problems: [] });
    expect(seen).toHaveLength(1);
    // the photo first, then the sheet, made small: the sheet is 1024 wide, the photo is not enlarged
    const [p, s] = await Promise.all(seen[0]!.map((b) => sharp(b).metadata()));
    expect([p!.width, p!.height]).toEqual([600, 800]);
    expect([s!.width, s!.height]).toEqual([1024, 683]);
    expect(adds).toEqual([0.005]);
  });
});
