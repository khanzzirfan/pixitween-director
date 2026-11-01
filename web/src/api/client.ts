import type {
  ApproveRequest,
  ChatRequest,
  ChatResponse,
  CreateFilmResponse,
  ListFilmsResponse,
  LocalModeResponse,
  UndoRedoResponse,
  VersionsResponse,
} from '@shared/api';
import { PASSCODE_HEADER } from '@shared/api';
import type { FilmState } from '@shared/composition';

export interface FramesResponse {
  review?: 'started';
  frames?: number;
  stored?: number;
  geometry: { maxRelError: number; layers: number } | null;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    super(`request failed with ${status}`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.body = body;
  }
}

function passcode(): string | null {
  try {
    return localStorage.getItem('director.passcode');
  } catch {
    return null;
  }
}

export async function request<T>(method: string, path: string, body?: BodyInit | null, json = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  const pass = method === 'GET' ? null : passcode();
  if (pass) headers[PASSCODE_HEADER] = pass;
  const res = await fetch(path, { method, headers, body });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // keep the raw text
  }
  if (!res.ok) throw new ApiRequestError(res.status, parsed);
  return parsed as T;
}

export const api = {
  getLocalMode: () => request<LocalModeResponse>('GET', '/api/local-mode'),
  putLocalMode: (local: boolean) => request<LocalModeResponse>('PUT', '/api/local-mode', JSON.stringify({ local }), true),
  listFilms: () => request<ListFilmsResponse>('GET', '/api/films'),
  getFilm: (id: string) => request<FilmState>('GET', `/api/films/${id}`),
  getVersions: (id: string) => request<VersionsResponse>('GET', `/api/films/${id}/versions`),
  createFilm: (form: FormData) => request<CreateFilmResponse>('POST', '/api/films', form),
  undo: (id: string) => request<UndoRedoResponse>('POST', `/api/films/${id}/undo`),
  redo: (id: string) => request<UndoRedoResponse>('POST', `/api/films/${id}/redo`),
  /** Review frames: a 'before' batch starts a review; a form with phase 'after' records the after pictures. */
  postFrames: (id: string, form: FormData) => request<FramesResponse>('POST', `/api/films/${id}/frames`, form),
  chat: (id: string, body: ChatRequest) => request<ChatResponse>('POST', `/api/films/${id}/chat`, JSON.stringify(body), true),
  approve: (id: string, sceneId: string, token: string) =>
    request<unknown>('POST', `/api/films/${id}/scenes/${sceneId}/approve`, JSON.stringify({ token } satisfies ApproveRequest), true),
};
