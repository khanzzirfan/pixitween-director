import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { parseCreateFilm, type InputError } from './films-input';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const file = (bytes: Buffer | string, name: string, type: string) => new File([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], name, { type });
const opts = { maxBytes: 1024 };
const fails = async (body: Record<string, unknown>) => (await parseCreateFilm(body, opts).catch((e) => e)) as InputError;

describe('parseCreateFilm', () => {
  it('accepts a photo with a text brief and defaults the aspect', async () => {
    const out = await parseCreateFilm({ product: file(png, 'p.png', 'image/png'), brief: '  a mug  ' }, opts);
    expect(out).toMatchObject({ brief: 'a mug', aspect: '16:9' });
    expect(out.product.mime).toBe('image/png');
  });
  it('requires a photo and sniffs its real type', async () => {
    expect((await fails({ brief: 'x' })).code).toBe('product_required');
    const bad = await fails({ product: file('not an image', 'p.png', 'image/png'), brief: 'x' });
    expect(bad).toMatchObject({ code: 'unsupported_media', status: 415 });
  });
  it('rejects oversize photos', async () => {
    const big = Buffer.concat([png, Buffer.alloc(2048)]);
    expect(await fails({ product: file(big, 'p.png', 'image/png'), brief: 'x' })).toMatchObject({ code: 'too_large', status: 413 });
  });
  it('needs exactly one of text or voice brief', async () => {
    const product = file(png, 'p.png', 'image/png');
    expect((await fails({ product })).code).toBe('brief_or_audio');
    const audio = file('abc', 'a.webm', 'audio/webm');
    expect((await fails({ product, brief: 'x', audio })).code).toBe('brief_or_audio');
    expect((await parseCreateFilm({ product, audio }, opts)).audio?.mime).toBe('audio/webm');
  });
  it('validates brief length and aspect', async () => {
    const product = file(png, 'p.png', 'image/png');
    expect((await fails({ product, brief: 'x'.repeat(2001) })).code).toBe('brief_too_long');
    expect((await fails({ product, brief: 'x', aspect: '4:3' })).code).toBe('bad_aspect');
    expect((await parseCreateFilm({ product, brief: 'x', aspect: '9:16' }, opts)).aspect).toBe('9:16');
  });
});
