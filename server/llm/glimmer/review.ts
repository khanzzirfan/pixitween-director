import type { Buffer } from 'node:buffer';
import { GlimmerError } from './errors';
import { postChat, type OllamaConn } from './http';

/** Frame review on the local model: the images travel as base64 strings in the message's images field, the answer as JSON via format. */
export async function glimmerReviewImages(
  images: Buffer[],
  prompt: string,
  schema: object | undefined,
  opts: { baseUrl: string; model: string; fetchImpl?: typeof fetch; keepAlive?: string } & Pick<OllamaConn, 'timeoutMs'>,
): Promise<unknown> {
  const { raw } = await postChat(opts, {
    model: opts.model,
    stream: false,
    think: false,
    keep_alive: opts.keepAlive ?? '30m',
    messages: [{ role: 'user', content: prompt, images: images.map((b) => b.toString('base64')) }],
    format: schema ?? 'json',
  });
  const content = (raw as { message?: { content?: unknown } }).message?.content;
  try {
    return JSON.parse(typeof content === 'string' ? content : '');
  } catch {
    throw new GlimmerError('invalid-json', undefined, 'the local reviewer did not answer with JSON');
  }
}
