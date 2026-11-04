import type { FilmId, FilmState, FilmVersion } from './composition';
import type { GallerySummary } from './gallery';

export const PASSCODE_HEADER = 'x-director-passcode';
/** A visitor's own Muse key. Sent only when they have not saved a Director code. */
export const MUSE_KEY_HEADER = 'x-muse-api-key';

export interface CreateFilmResponse {
  filmId: FilmId;
  queue?: { state: 'running' } | { state: 'queued'; position: number; etaSec: number };
}
export type ListFilmsResponse = FilmState[];
export type GalleryResponse = GallerySummary[];
export type VersionsResponse = FilmVersion[];
export interface UndoRedoResponse {
  version: number;
}
export interface ChatRequest {
  message: string;
  selection?: { sceneId?: string; layerId?: string };
  local?: boolean;
}
export interface ChatResponse {
  accepted: true;
}
export interface FramesRequestFields {
  phase?: 'before' | 'after';
  textBoxes?: unknown;
}
export interface FramesResponse {
  review: 'started';
}
export interface SceneModeRequest {
  mode: 'motion' | 'generate';
}
export interface SceneModeResponse {
  mode: 'motion' | 'generate';
  proposal?: unknown;
}
export interface ApproveRequest {
  token: string;
}
/** GET /api/local-mode, and the answer to a successful PUT: the flag plus what Ollama says about the model. */
export interface LocalModeResponse {
  local: boolean;
  reachable: boolean;
  modelPresent: boolean;
  /** null when Ollama could not say */
  loaded: boolean | null;
  model: string;
  host: string;
  checkedAt: string;
  error?: string;
}
export interface HealthResponse {
  ok: true;
  version: string;
  metaConfigured?: boolean;
  ffmpeg?: boolean;
  validator?: 'engine' | 'light';
  replay?: boolean;
}
export interface ApiError {
  error: string;
  owner?: string;
  message?: string;
}

/** E1: server-side MP4 export. */
export interface ExportStartRequest {
  fps: number;
  frames: number;
  width: number;
  height: number;
}
export interface ExportStartResponse {
  id: string;
}
export interface ExportCheckResponse {
  problems: string[];
}

/** The one video provider a visitor can paste a key for. The key is stored for that browser session and that IP only. */
export const VIDEO_PROVIDERS = ['fal'] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

export interface VideoKeyStatus {
  fal: boolean;
}

/** Omitted fields stay as they are. A name in `clear` removes that key. Values are write-only. */
export interface VideoKeyUpdate {
  fal?: string;
  clear?: VideoProvider[];
}

/** Resolutions the AI movie is offered at: a cheap draft and the standard cut. */
export const AI_VIDEO_RESOLUTIONS = ['480P', '768P'] as const;
export type AiVideoResolution = (typeof AI_VIDEO_RESOLUTIONS)[number];

/** What an AI movie of this film would be and cost, before anything is spent. */
export interface AiVideoQuote {
  resolution: AiVideoResolution;
  /** Length of the clip the model makes. A film longer than the model allows is cut to fit. */
  durationSec: number;
  filmSec: number;
  costUsd: number;
  /** How many of the film's scenes become reference frames. */
  frames: number;
  /** Scenes with nothing to draw a frame from (a generated clip, a bare 3D stage). */
  skippedScenes: string[];
  /** Whether the visitor has saved a Fal key. The server never spends one of its own. */
  keyReady: boolean;
}

export type AiVideoStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface AiVideoJob {
  id: string;
  filmId: string;
  status: AiVideoStatus;
  resolution: AiVideoResolution;
  durationSec: number;
  costUsd: number;
  queuePosition?: number;
  /** Same-origin URL of the finished MP4, set once the job has succeeded. */
  videoUrl?: string;
  error?: string;
}
