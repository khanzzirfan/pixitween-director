// Seedance 2.5 on Revana: a 3D stage becomes a movie. Frames are uploaded, then one generation is quoted and run.
// image_url is the opening frame and cannot be sent together with reference media. Docs: https://revana.si/models/seedance-2.5
import type { GenerateOptions, RevanaClient } from './client';
import type { RevanaGeneration } from './types';

export const SEEDANCE_MODEL = 'seedance-2.5';

export const SEEDANCE_RESOLUTIONS = ['480p', '720p', '1080p'] as const;
export const SEEDANCE_ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'] as const;

export type SeedanceResolution = (typeof SEEDANCE_RESOLUTIONS)[number];
export type SeedanceAspect = (typeof SEEDANCE_ASPECTS)[number];

export interface SeedanceInput {
  prompt: string;
  resolution?: SeedanceResolution;
  /** Whole seconds, 4 to 30. Leave unset when editing a clip with video_url. */
  duration?: number;
  aspect_ratio?: SeedanceAspect;
  audio?: boolean;
  /** Opening frame. Not allowed together with image_urls, video_urls or audio_urls. */
  image_url?: string;
  /** Closing frame. Requires image_url. */
  end_image_url?: string;
  /** Reference stills, up to 30. */
  image_urls?: string[];
  /** Reference clips, up to 10, 30 seconds in all. */
  video_urls?: string[];
  /** Reference sounds, up to 10, 30 seconds in all. */
  audio_urls?: string[];
  /** A 4–30s clip to edit. The result keeps its length, so duration is omitted. */
  video_url?: string;
}

export interface StageStill {
  bytes: Buffer;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  filename?: string;
}

export interface StageFilmRequest {
  prompt: string;
  /** Rendered frames from the 3D stage, in order. One opens the shot. Two bookend it. Three or more are references. */
  frames: StageStill[];
  /** Force every frame into image_urls, including a pair that would otherwise be first and last. */
  asReferences?: boolean;
  resolution?: SeedanceResolution;
  duration?: number;
  aspectRatio?: SeedanceAspect;
  audio?: boolean;
  maxCostUsd?: number;
}

export interface StageFilm {
  generation: RevanaGeneration;
  mp4: Buffer;
  input: SeedanceInput;
}

export class SeedanceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedanceInputError';
  }
}

/** Refuse a body Seedance would answer 422 for, before any credit is reserved. */
export function assertSeedanceInput(input: SeedanceInput): void {
  if (!input.prompt?.trim()) throw new SeedanceInputError('Seedance needs a prompt');
  if (input.resolution && !SEEDANCE_RESOLUTIONS.includes(input.resolution)) {
    throw new SeedanceInputError(`Seedance resolution must be 480p, 720p or 1080p`);
  }
  if (input.aspect_ratio && !SEEDANCE_ASPECTS.includes(input.aspect_ratio)) {
    throw new SeedanceInputError(`Seedance aspect ratio is not one it offers`);
  }
  if (input.duration !== undefined) {
    if (!Number.isInteger(input.duration) || input.duration < 4 || input.duration > 30) {
      throw new SeedanceInputError(`Seedance duration must be a whole number of seconds from 4 to 30`);
    }
  }
  if (input.video_url && input.duration !== undefined) {
    throw new SeedanceInputError('Leave duration out when editing a clip: the result keeps the clip length');
  }
  const references = (input.image_urls?.length ?? 0) + (input.video_urls?.length ?? 0) + (input.audio_urls?.length ?? 0) > 0;
  if (input.image_url && references) {
    throw new SeedanceInputError('An opening frame cannot be combined with reference images, clips or sounds');
  }
  if (input.end_image_url && !input.image_url) throw new SeedanceInputError('A closing frame needs an opening frame');
  if ((input.image_urls?.length ?? 0) > 30) throw new SeedanceInputError('Seedance takes at most 30 reference images');
  if ((input.video_urls?.length ?? 0) > 10) throw new SeedanceInputError('Seedance takes at most 10 reference clips');
  if ((input.audio_urls?.length ?? 0) > 10) throw new SeedanceInputError('Seedance takes at most 10 reference sounds');
}

/** The JSON input object, with empty optional fields left out so Revana does not reject them. */
export function seedanceBody(input: SeedanceInput): Record<string, unknown> {
  assertSeedanceInput(input);
  const body: Record<string, unknown> = { prompt: input.prompt.trim() };
  const copy = ['resolution', 'duration', 'aspect_ratio', 'audio', 'image_url', 'end_image_url', 'image_urls', 'video_urls', 'audio_urls', 'video_url'] as const;
  for (const key of copy) {
    const value = input[key];
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    body[key] = value;
  }
  return body;
}

/**
 * Turn rendered stage frames into a Seedance movie.
 * One frame is the opening picture. Two are the opening and closing pictures. More than two are references.
 */
export async function filmFromStage(client: RevanaClient, request: StageFilmRequest, opts?: GenerateOptions): Promise<StageFilm> {
  if (request.frames.length === 0) throw new SeedanceInputError('Seedance needs at least one rendered frame');
  const urls = await Promise.all(request.frames.map((frame, i) => client.upload(frame.bytes, frame.contentType, frame.filename ?? `frame-${i + 1}.png`, { signal: opts?.signal })));
  const bookend = !request.asReferences && urls.length <= 2;
  const input: SeedanceInput = {
    prompt: request.prompt,
    resolution: request.resolution,
    duration: request.duration,
    aspect_ratio: request.aspectRatio,
    audio: request.audio,
    ...(bookend
      ? { image_url: urls[0], ...(urls[1] ? { end_image_url: urls[1] } : {}) }
      : { image_urls: urls }),
  };
  const generation = await client.generate(SEEDANCE_MODEL, seedanceBody(input), { ...opts, maxCostUsd: request.maxCostUsd ?? opts?.maxCostUsd });
  const mp4 = await client.download(generation.id, 1, { signal: opts?.signal });
  return { generation, mp4, input };
}
