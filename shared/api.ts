import type { FilmId, FilmState, FilmVersion } from './composition';

export const PASSCODE_HEADER = 'x-director-passcode';

export interface CreateFilmResponse {
  filmId: FilmId;
  queue?: { state: 'running' } | { state: 'queued'; position: number; etaSec: number };
}
export type ListFilmsResponse = FilmState[];
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
