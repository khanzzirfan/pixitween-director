// MiniMax M3 on Revana is a chat model, not a video model. It writes the motion prompt Seedance then films.
import type { RevanaClient } from './client';

export const MINIMAX_M3_MODEL = 'minimax-m3';

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  text: string;
  costUsd?: number;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  usage?: { cost_usd?: number };
}

function textOf(content: string | Array<{ text?: string }> | undefined): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map((part) => part.text ?? '').join('').trim();
  return '';
}

/** One MiniMax M3 completion. The key is the same Revana key Seedance uses. */
export async function completeMinimax(client: RevanaClient, messages: ChatTurn[], opts?: { maxTokens?: number; temperature?: number; signal?: AbortSignal }): Promise<ChatResult> {
  if (messages.length === 0) throw new Error('MiniMax M3 needs at least one message');
  const raw = (await client.chat(
    {
      model: MINIMAX_M3_MODEL,
      messages,
      ...(opts?.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
    },
    { signal: opts?.signal },
  )) as ChatResponse;
  const text = textOf(raw.choices?.[0]?.message?.content);
  if (!text) throw new Error('MiniMax M3 returned no text');
  return { text, ...(raw.usage?.cost_usd !== undefined ? { costUsd: raw.usage.cost_usd } : {}) };
}

const MOTION_SYSTEM = [
  'You write one Seedance 2.5 motion prompt for a product film.',
  'Describe the camera, the product, the light and the end card in four sentences or fewer.',
  'Do not mention models, APIs or prices. Reply with the prompt only.',
].join(' ');

/** Ask MiniMax M3 for the prompt a Seedance movie of this brief should use. */
export function motionPrompt(client: RevanaClient, brief: string, opts?: { signal?: AbortSignal }): Promise<ChatResult> {
  const text = brief.trim();
  if (!text) throw new Error('A motion prompt needs a brief');
  return completeMinimax(client, [
    { role: 'system', content: MOTION_SYSTEM },
    { role: 'user', content: text },
  ], { maxTokens: 280, temperature: 0.4, signal: opts?.signal });
}
