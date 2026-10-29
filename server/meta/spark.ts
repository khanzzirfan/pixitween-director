import type { Buffer } from 'node:buffer';
import type { ChatRequest, ChatResponse, MetaClients } from '@shared/ports';
import type { MetaHttp } from './http';
import { dataUrl, sniffImageMime } from './mime';

export class SparkProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SparkProtocolError';
  }
}

interface RawChat {
  choices: Array<{ message: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
  usage?: { prompt_tokens: number; completion_tokens: number; completion_tokens_details?: { reasoning_tokens?: number } };
  model?: string;
}

export function createSparkClient(http: MetaHttp, opts: { model: string }): MetaClients['spark'] {
  const post = (body: Record<string, unknown>, signal?: AbortSignal) => http.json<RawChat>('/chat/completions', body, signal ? { signal } : undefined);

  return {
    async chat(req: ChatRequest, callOpts?: { signal?: AbortSignal }): Promise<ChatResponse> {
      const r = await post({ ...req, model: req.model ?? opts.model }, callOpts?.signal);
      const msg = r.body.choices[0]?.message;
      if (!msg) throw new SparkProtocolError('chat response had no choices');
      const toolCalls = (msg.tool_calls ?? []).map((c) => {
        try {
          return { id: c.id, name: c.function.name, args: JSON.parse(c.function.arguments || '{}') as unknown };
        } catch {
          throw new SparkProtocolError(`tool '${c.function.name}' sent arguments that are not JSON: ${c.function.arguments.slice(0, 200)}`);
        }
      });
      const u = r.body.usage;
      return {
        ...(msg.content ? { content: msg.content } : {}),
        toolCalls,
        ...(u
          ? {
              usage: {
                promptTokens: u.prompt_tokens,
                completionTokens: u.completion_tokens,
                ...(u.completion_tokens_details?.reasoning_tokens !== undefined ? { reasoningTokens: u.completion_tokens_details.reasoning_tokens } : {}),
              },
            }
          : {}),
        ms: r.ms,
        model: r.body.model ?? req.model ?? opts.model,
      };
    },

    async reviewImages(images: Buffer[], prompt: string, schema?: object): Promise<unknown> {
      const content = [
        { type: 'text', text: prompt },
        ...images.map((img) => ({ type: 'image_url', image_url: { url: dataUrl(img, sniffImageMime(img)) } })),
      ];
      const r = await post({
        model: opts.model,
        messages: [{ role: 'user', content }],
        response_format: schema ? { type: 'json_schema', json_schema: { name: 'review', strict: true, schema } } : { type: 'json_object' },
      });
      const text = r.body.choices[0]?.message.content ?? '';
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new SparkProtocolError(`review reply is not JSON: ${text.slice(0, 200)}`);
      }
    },

    async video(mp4: Buffer, prompt: string): Promise<string> {
      const r = await http.json<{ output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> }>('/responses', {
        model: opts.model,
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_video', video_url: dataUrl(mp4, 'video/mp4') }] }],
      });
      const direct = r.body.output_text;
      if (direct) return direct;
      for (const o of r.body.output ?? []) for (const c of o.content ?? []) if (c.text) return c.text;
      throw new SparkProtocolError('video response carried no text');
    },
  };
}
