import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

export interface FakeClippyServerOptions {
  balance?: number;
  /** HTTP-level failure (500) for the first N tools/call requests of this tool. */
  failFirst?: { tool: string; times: number };
  /** Never answer calls of this tool. */
  hang?: string;
  /** Answer calls of this tool with isError true. */
  toolError?: { tool: string; text: string };
  /** Answer calls of this tool with this raw text. */
  rawText?: { tool: string; text: string };
}

/** An in-process MCP server (stateless Streamable HTTP) standing in for Clippy. */
export async function startFakeClippyServer(o: FakeClippyServerOptions = {}) {
  const authHeaders: Array<string | undefined> = [];
  const toolCalls: Array<{ tool: string; args: unknown }> = [];
  const failed = new Map<string, number>();
  const text = (t: unknown) => ({ content: [{ type: 'text' as const, text: typeof t === 'string' ? t : JSON.stringify(t) }] });

  const build = () => {
    const s = new McpServer({ name: 'fake-clippy', version: '1' });
    const reply = (tool: string, result: unknown) => {
      toolCalls.push({ tool, args: undefined });
      if (o.toolError?.tool === tool) return { ...text(o.toolError.text), isError: true };
      if (o.rawText?.tool === tool) return text(o.rawText.text);
      return text(result);
    };
    s.registerTool('get_credit_balance', { description: 'balance' }, async () => reply('get_credit_balance', { totalEarned: 200, totalUsed: 80, currentBalance: o.balance ?? 120, expiringCredits: 0 }));
    s.registerTool('list_live_animate_models', { description: 'models' }, async () => reply('list_live_animate_models', { models: ['fast-h3', 'fast-h3-omni'] }));
    s.registerTool('animate_image', { description: 'animate', inputSchema: { model: z.string(), prompt: z.string(), durationSec: z.number(), aspect: z.string(), sourceImageUrl: z.string().optional(), imageUrls: z.array(z.string()).optional(), idempotencyKey: z.string().optional() } }, async (args) => {
      const r = reply('animate_image', { jobId: 'job_test_1', status: 'rendering', estimatedCredits: 25 });
      toolCalls[toolCalls.length - 1]!.args = args;
      return r;
    });
    s.registerTool('get_live_animate_status', { description: 'status', inputSchema: { jobId: z.string() } }, async () =>
      reply('get_live_animate_status', { jobId: 'job_test_1', status: 'done', progress: 1, resultUrl: 'https://clip.example.test/out.mp4', error: null }),
    );
    s.registerTool('cancel_live_animate', { description: 'cancel', inputSchema: { jobId: z.string() } }, async () => reply('cancel_live_animate', { jobId: 'job_test_1', status: 'cancelled' }));
    return s;
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      authHeaders.push(req.headers.authorization);
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: { method?: string; params?: { name?: string } } | undefined;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = undefined;
      }
      const tool = body?.method === 'tools/call' ? body.params?.name : undefined;
      if (tool && o.hang === tool) return; // never answers
      if (tool && o.failFirst?.tool === tool && (failed.get(tool) ?? 0) < o.failFirst.times) {
        failed.set(tool, (failed.get(tool) ?? 0) + 1);
        res.writeHead(500).end('boom');
        return;
      }
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      const mcp = build();
      res.on('close', () => void transport.close());
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    authHeaders,
    toolCalls,
    close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))),
  };
}
