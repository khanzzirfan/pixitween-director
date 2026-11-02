// Owned by S7a. A typed client for Clippy's MCP server over Streamable HTTP.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { z } from 'zod';
import {
  animateImageArgsSchema, balanceResultSchema, statusResultSchema, submitResultSchema,
  type AnimateImageArgs, type BalanceResult, type StatusResult, type SubmitResult,
} from './types';

export class ClippyError extends Error {
  readonly tool: string;
  readonly isToolError: boolean;
  readonly status?: number;
  constructor(message: string, o: { tool?: string; isToolError?: boolean; status?: number } = {}) {
    super(message);
    this.name = 'ClippyError';
    this.tool = o.tool ?? '';
    this.isToolError = o.isToolError ?? false;
    this.status = o.status;
  }
}

export interface ClippyClient {
  listLiveAnimateModels(): Promise<unknown>;
  getCreditBalance(): Promise<BalanceResult>;
  animateImage(args: AnimateImageArgs): Promise<SubmitResult>;
  getLiveAnimateStatus(jobId: string): Promise<StatusResult>;
  cancelLiveAnimate(jobId: string): Promise<unknown>;
  close(): Promise<void>;
}

export interface ClippyClientOptions {
  url: string;
  token: string;
  timeoutMs?: number;
  /** Injectable so tests do not wait; reads retry once after 2000 ms. */
  sleep?: (ms: number) => Promise<void>;
}

const READ_RETRY_DELAY_MS = 2000;

export function createClippyClient(o: ClippyClientOptions): ClippyClient {
  const timeoutMs = o.timeoutMs ?? 60_000;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const redact = (s: string) => (o.token ? s.split(o.token).join('[redacted]') : s);
  let client: Client | undefined;
  let transport: StreamableHTTPClientTransport | undefined;

  async function connect(): Promise<Client> {
    if (client) return client;
    const t = new StreamableHTTPClientTransport(new URL(o.url), { requestInit: { headers: { Authorization: `Bearer ${o.token}` } } });
    const c = new Client({ name: 'pixitween-director', version: '1' });
    await c.connect(t);
    transport = t;
    return (client = c);
  }

  async function call<T>(tool: string, args: Record<string, unknown>, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ClippyError('timeout', { tool })), timeoutMs);
    });
    try {
      const run = (async () => {
        const c = await connect();
        const res = (await c.callTool({ name: tool, arguments: args }, undefined, { timeout: timeoutMs })) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
        const text = res.content?.find((p) => p.type === 'text')?.text ?? '';
        if (res.isError) throw new ClippyError(redact(`${tool} failed: ${text}`), { tool, isToolError: true });
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          throw new ClippyError('unexpected response', { tool });
        }
        const parsed = schema.safeParse(json);
        if (!parsed.success) throw new ClippyError('unexpected response', { tool });
        return parsed.data;
      })();
      return await Promise.race([run, timeout]);
    } catch (e) {
      if (e instanceof ClippyError) throw e;
      throw new ClippyError(redact(`${tool} transport error: ${(e as Error).message}`), { tool });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Reads retry once on a transport error (not a tool error). Writes are never retried: a retry could double-charge. */
  async function withReadRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ClippyError && (e.isToolError || e.message === 'timeout' || e.message === 'unexpected response')) throw e;
      client = undefined; // reconnect on the retry
      await sleep(READ_RETRY_DELAY_MS);
      return fn();
    }
  }

  const passthrough = { parse: (v: unknown) => v, safeParse: (v: unknown) => ({ success: true as const, data: v }) } as unknown as z.ZodType<unknown, z.ZodTypeDef, unknown>;

  return {
    listLiveAnimateModels: () => withReadRetry(() => call('list_live_animate_models', {}, passthrough)),
    getCreditBalance: () => withReadRetry(() => call('get_credit_balance', {}, balanceResultSchema)),
    animateImage: (args) => call('animate_image', animateImageArgsSchema.parse(args) as Record<string, unknown>, submitResultSchema),
    getLiveAnimateStatus: (jobId) => withReadRetry(() => call('get_live_animate_status', { jobId }, statusResultSchema)),
    cancelLiveAnimate: (jobId) => call('cancel_live_animate', { jobId }, passthrough),
    async close() {
      try {
        await transport?.terminateSession();
      } catch {
        // the server may not support session termination
      }
      await client?.close().catch(() => undefined);
      client = undefined;
      transport = undefined;
    },
  };
}
