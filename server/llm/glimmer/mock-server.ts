// Test helper: a tiny Ollama stand-in that replays queued replies and records every request body.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export type MockReply = { status?: number; body: unknown; delayMs?: number };

export interface MockOllama {
  baseUrl: string;
  requests: Array<{ path: string; body: Record<string, unknown>; at: number }>;
  replies: MockReply[];
  repliedAt: number[];
  close(): Promise<void>;
}

export async function startMockOllama(replies: MockReply[] = []): Promise<MockOllama> {
  const state = { requests: [] as MockOllama['requests'], replies: [...replies], repliedAt: [] as number[] };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>) : {};
      state.requests.push({ path: req.url ?? '', body, at: Date.now() });
      const reply = state.replies.shift() ?? { status: 500, body: { error: 'mock has no more replies' } };
      setTimeout(() => {
        res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' });
        res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
        state.repliedAt.push(Date.now());
      }, reply.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests: state.requests,
    replies: state.replies,
    repliedAt: state.repliedAt,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
