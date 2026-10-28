import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface SeenRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
  raw: Buffer;
}

/** Parse a recorded multipart request into FormData. */
export const parseForm = (r: SeenRequest): Promise<FormData> =>
  new Request('http://x/', { method: 'POST', headers: { 'content-type': String(r.headers['content-type']) }, body: new Uint8Array(r.raw) }).formData();
export type Handler = (req: SeenRequest, res: ServerResponse, n: number) => void | Promise<void>;

/** In-process HTTP server for client tests. `seen` records every request; `maxConcurrent` the peak in flight. */
export async function startTestServer(handler: Handler) {
  const seen: SeenRequest[] = [];
  let active = 0;
  let maxConcurrent = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      active++;
      maxConcurrent = Math.max(maxConcurrent, active);
      const r: SeenRequest = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8'), raw: Buffer.concat(chunks) };
      seen.push(r);
      try {
        await handler(r, res, seen.length);
      } finally {
        active--;
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    seen,
    get maxConcurrent() {
      return maxConcurrent;
    },
    close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))),
  };
}

export const sendJson = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};
