import { Hono } from 'hono';
import { expect, it } from 'vitest';
import { createUploadLimit } from './upload-limit';

const app = new Hono();
app.use('*', createUploadLimit({ maxMb: 1 }));
app.post('/api/films', (c) => c.text('ok'));
app.post('/api/films/:id/chat', (c) => c.text('ok'));
const send = (path: string, bytes: number) => app.request(path, { method: 'POST', body: new Uint8Array(bytes), headers: { 'content-type': 'application/octet-stream' } });

it('rejects a 2 MB film upload with 413', async () => {
  const res = await send('/api/films', 2 * 1024 * 1024);
  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({ error: 'payload_too_large', maxMb: 1 });
});

it('lets a small upload through and ignores other paths', async () => {
  expect((await send('/api/films', 100 * 1024)).status).toBe(200);
  expect((await send('/api/films/abc/chat', 2 * 1024 * 1024)).status).toBe(200);
});
