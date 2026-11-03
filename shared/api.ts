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

/** Video providers a visitor can paste in Settings. Each key is stored for that browser session and that IP only. */
export const VIDEO_PROVIDERS = ['fal', 'higgsfield', 'revana'] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

export interface VideoKeyStatus {
  fal: boolean;
  higgsfield: boolean;
  revana: boolean;
}

/** Omitted fields stay as they are. A name in `clear` removes that key. Values are write-only. */
export interface VideoKeyUpdate {
  fal?: string;
  higgsfield?: string;
  revana?: string;
  clear?: VideoProvider[];
}

/** A 9:16 reel. The server spends only the key saved for this browser session and this IP. */
export interface VideoCreateRequest {
  provider: VideoProvider;
  prompt: string;
  imageUrl?: string;
  duration?: number;
}

export interface VideoJobResponse {
  id: string;
  provider: VideoProvider;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  videoUrl?: string;
}
