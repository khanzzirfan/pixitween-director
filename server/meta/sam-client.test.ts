import { afterEach, expect, it } from 'vitest';
import { readSeedBuffer, readSeedText } from '../test-utils/fixtures';
import { MetaApiError, createMetaHttp } from './http';
import { createSamClient } from './sam';
import { startTestServer, sendJson } from './test-server';

let srv: Awaited<ReturnType<typeof startTestServer>> | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
});
const client = () => createSamClient(createMetaHttp({ baseUrl: srv!.baseUrl, apiKey: () => 'k', retryDelayMs: 0 }));
const sse = (file: string) => (_r: unknown, res: Parameters<Parameters<typeof startTestServer>[0]>[1]) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(readSeedText(file));
};

it('segmentImage sends the verified body and resolves to the seed object', async () => {
  srv = await startTestServer(sse('sam-image-product.sse.txt'));
  const objs = await client().segmentImage(readSeedBuffer('mug-product.png'), 'mug');
  expect(objs).toHaveLength(1);
  expect(objs[0]!.bounds.left).toBe(180);
  const req = srv.seen[0]!;
  expect(req.url).toContain('/responses');
  expect(req.headers.accept).toBe('text/event-stream');
  const body = JSON.parse(req.body);
  expect(body).toMatchObject({ model: 'sam-3.1', stream: true, metadata: { include_confidence: 'true' } });
  expect(body.input[0].content[0]).toEqual({ type: 'input_text', text: 'mug' });
  expect(body.input[0].content[1].image_url.startsWith('data:image/png;base64,')).toBe(true);
});

it('trackVideo sends input_video and one_bit masks', async () => {
  srv = await startTestServer(sse('sam-video-truncated.sse.txt'));
  const r = await client().trackVideo(Buffer.from('mp4'), 'coffee cup');
  expect(r.objectIds).toEqual(expect.arrayContaining(['0', '1']));
  const body = JSON.parse(srv.seen[0]!.body);
  expect(body.input[0].content[1].type).toBe('input_video');
  expect(body.input[0].content[1].video_url.startsWith('data:video/mp4;base64,')).toBe(true);
  expect(body.metadata).toEqual({ include_confidence: 'true', mask_encoding: 'one_bit' });
});

it('a 400 rejects with MetaApiError', async () => {
  srv = await startTestServer((_r, res) => sendJson(res, 400, { error: 'bad' }));
  await expect(client().segmentImage(readSeedBuffer('mug-product.png'), 'mug')).rejects.toMatchObject({ status: 400 });
  await expect(client().segmentImage(readSeedBuffer('mug-product.png'), 'mug')).rejects.toBeInstanceOf(MetaApiError);
});
