import { afterEach, expect, it } from 'vitest';
import { readSeedBuffer } from '../test-utils/fixtures';
import { createMetaHttp } from './http';
import { MuseImageError, createImageClient } from './image';
import { parseForm, sendJson, startTestServer } from './test-server';

let srv: Awaited<ReturnType<typeof startTestServer>> | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
});
const client = () => createImageClient(createMetaHttp({ baseUrl: srv!.baseUrl, apiKey: () => 'k', retryDelayMs: 0 }));
const plate = readSeedBuffer('cafe-plate.jpg');
const ok = (_r: unknown, res: Parameters<Parameters<typeof startTestServer>[0]>[1]) => sendJson(res, 200, { data: [{ b64_json: plate.toString('base64') }] });

it('generate sends png output and tools off, and returns the decoded bytes', async () => {
  srv = await startTestServer(ok);
  const out = await client().generate('empty plate');
  expect(out.equals(plate)).toBe(true);
  expect(srv.seen[0]!.url).toContain('/images/generations');
  expect(JSON.parse(srv.seen[0]!.body)).toMatchObject({
    model: 'muse-image-1.0', size: '1536x1024', n: 1, output_format: 'png',
    tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
  });
});

it('edit with one reference uses the field `image`', async () => {
  srv = await startTestServer(ok);
  await client().edit('p', [readSeedBuffer('mug-product.png')]);
  const form = await parseForm(srv.seen[0]!);
  expect([...form.keys()].sort()).toEqual(['image', 'model', 'output_format', 'prompt', 'size']);
  expect((form.get('image') as File).type).toBe('image/png');
  expect(form.get('output_format')).toBe('png');
});

it('edit with two references uses image[0] and image[1], never image[]', async () => {
  srv = await startTestServer(ok);
  await client().edit('p', [readSeedBuffer('mug-product.png'), plate]);
  const keys = [...(await parseForm(srv.seen[0]!)).keys()];
  expect(keys).toContain('image[0]');
  expect(keys).toContain('image[1]');
  expect(keys).not.toContain('image[]');
  expect(keys).not.toContain('image');
});

it('throws MuseImageError when no image comes back or no refs are given', async () => {
  srv = await startTestServer((_r, res) => sendJson(res, 200, {}));
  await expect(client().generate('x')).rejects.toThrow(/no image/);
  await expect(client().generate('x')).rejects.toBeInstanceOf(MuseImageError);
  await expect(client().edit('x', [])).rejects.toBeInstanceOf(MuseImageError);
});
