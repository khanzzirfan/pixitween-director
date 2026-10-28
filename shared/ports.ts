import type { Buffer } from 'node:buffer';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import type { AssetRef, FilmId, FilmState, FilmVersion } from './composition';
import type { ToolDef } from './tools';

// ---- Meta chat types (design 4.3) ----
export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[] | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}
export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: object };
}
export interface ChatRequest {
  model?: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  tool_choice?: 'auto' | 'none' | 'required';
  response_format?: { type: 'json_object' } | { type: 'json_schema'; json_schema: { name: string; strict?: boolean; schema: object } };
  temperature?: number;
  /** Output cap. Reasoning models spend most of it thinking, so leave it generous. */
  max_tokens?: number;
}
export interface ToolCall {
  id: string;
  name: string;
  args: unknown; // JSON.parse of function.arguments
}
export interface ChatResponse {
  content?: string;
  toolCalls: ToolCall[];
  usage?: { promptTokens: number; completionTokens: number; reasoningTokens?: number };
  ms: number;
  model: string;
}

// ---- SAM and Transcribe (design 4.4, 4.5) ----
export interface SamObject {
  objectId: string;
  bounds: { left: number; top: number; right: number; bottom: number };
  alpha: Buffer; // 8-bit, w*h, full frame
  confidence?: number;
}
export interface TranscribeResult {
  transcript: string;
  turns: Array<{ startMs: number; endMs: number; transcript: string; speaker?: string }>;
  audioDurationMs?: number;
}

// ---- Stores ----
export interface FilmStore {
  create(
    init: Omit<FilmState, 'id' | 'version' | 'costUsd' | 'clippyCredits' | 'status' | 'createdAt'> & { createdAt?: string },
  ): Promise<FilmState>;
  get(id: FilmId): Promise<FilmState>;
  // Validates with the active composition validator; on failure returns the issues and stores nothing.
  // `FilmState.version` is the current pointer; a commit after an undo DISCARDS the redo tail; versions() lists every stored version.
  commit(
    id: FilmId,
    next: AepCompositionJson,
    source: FilmVersion['source'],
    note?: string,
  ): Promise<{ ok: true; version: number } | { ok: false; issues: unknown }>;
  // Read, apply, validate and commit as ONE step inside the per-film lock (D-15).
  // `fn` is pure and SYNCHRONOUS. If it throws, nothing is stored, the lock is released and the error is rethrown.
  mutate<T>(
    id: FilmId,
    fn: (film: FilmState) => { next: AepCompositionJson; data: T },
    source: FilmVersion['source'],
    note?: string,
  ): Promise<{ ok: true; version: number; data: T } | { ok: false; issues: unknown }>;
  update(id: FilmId, patch: Partial<Pick<FilmState, 'status' | 'storyboard' | 'title'>>): Promise<void>;
  undo(id: FilmId): Promise<number>;
  redo(id: FilmId): Promise<number>;
  versions(id: FilmId): Promise<FilmVersion[]>;
  list(): Promise<FilmState[]>;
}

// Asset ids are unguessable (128-bit random, hex): GET /api/assets/:id is unauthenticated.
export interface AssetStore {
  put(bytes: Buffer, mime: string, meta?: Partial<AssetRef>): Promise<AssetRef>;
  read(id: string): Promise<Buffer>;
  list(): Promise<AssetRef[]>;
  url(id: string): string;
}

// ---- Meta clients ----
export interface MetaClients {
  spark: {
    chat(req: ChatRequest): Promise<ChatResponse>;
    reviewImages(images: Buffer[], prompt: string, schema?: object): Promise<unknown>;
    video(mp4: Buffer, prompt: string): Promise<string>;
  };
  image: {
    edit(prompt: string, refs: Buffer[], size?: string): Promise<Buffer>;
    generate(prompt: string, size?: string): Promise<Buffer>;
  };
  sam: {
    segmentImage(img: Buffer, noun: string): Promise<SamObject[]>;
    trackVideo(mp4: Buffer, noun: string): Promise<{ frames: number; framesWithObject: number[]; objectIds: string[] }>;
  };
  transcribe: {
    file(wav16k: Buffer, opts: { keywords?: string[]; diarize?: boolean }): Promise<TranscribeResult>;
  };
}

export interface LlmBackend {
  id: 'spark' | 'glimmer' | 'spark-open';
  chatWithTools(
    messages: ChatMessage[],
    tools: ToolDef[],
    opts?: { parallelHint?: boolean },
  ): Promise<{ toolCalls: Array<{ id: string; name: string; args: unknown }>; content?: string; ms: number; usage?: unknown }>;
}

export interface Ledger {
  add(filmId: FilmId, model: string, units: string, usd: number): void;
  addCredits(filmId: FilmId, credits: number, note: string): void;
  total(filmId: FilmId): number;
  credits(filmId: FilmId): number;
}

// Film admission (D-16): decides whether a new film may start now, must wait, or is refused.
export interface FilmAdmission {
  canAccept(): { ok: true } | { ok: false; retryAfterSec: number };
  submit(
    filmId: FilmId,
    run: () => Promise<void>,
  ): { state: 'running' } | { state: 'queued'; position: number; etaSec: number } | { state: 'rejected'; retryAfterSec: number };
  position(filmId: FilmId): { state: 'running' } | { state: 'queued'; position: number; etaSec: number } | { state: 'unknown' };
  stats(): {
    inFlight: number;
    queued: number;
    maxInFlight: number;
    maxQueued: number;
    startsInWindow: number;
    startsPerWindow: number;
    windowSec: number;
  };
}
