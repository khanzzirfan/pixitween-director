// Owned by S12d. The crew endpoints, sent with the passcode header like the rest of the client.
import type { Job, StoryboardOp } from '@shared/crew';
import { request } from '../api/client';

export interface CrewSnapshot {
  jobs: Job[];
  storyboardRev: number;
}
export interface CrewConfig {
  enabled: boolean;
  /** Scenes may show the product as a turning 3D model. */
  product3d?: boolean;
}

const enc = encodeURIComponent;
export const postStoryboard = (filmId: string, ops: StoryboardOp[]) =>
  request<{ rev: number }>('POST', `/api/films/${filmId}/storyboard`, JSON.stringify({ ops }), true);
export const cancelJob = (filmId: string, jobId: string) => request<{ ok: boolean }>('POST', `/api/films/${filmId}/jobs/${enc(jobId)}/cancel`);
export const pickTake = (filmId: string, jobId: string, takeFilmId: string) =>
  request<{ version: number }>('POST', `/api/films/${filmId}/takes/${enc(jobId)}/pick`, JSON.stringify({ takeFilmId }), true);
export const revertScene = (filmId: string, sceneId: string) => request<{ version: number }>('POST', `/api/films/${filmId}/scenes/${enc(sceneId)}/revert`);
export const getCrew = (filmId: string) => request<CrewSnapshot>('GET', `/api/films/${filmId}/crew`);
export const getCrewConfig = () => request<CrewConfig>('GET', '/api/crew/config');
export function postVoice(filmId: string, blob: Blob) {
  const form = new FormData();
  form.set('audio', new File([blob], 'voice.webm', { type: blob.type || 'audio/webm' }));
  return request<{ accepted: boolean; transcript: string }>('POST', `/api/films/${filmId}/voice`, form);
}

export interface CrewActions {
  postStoryboard(ops: StoryboardOp[]): Promise<unknown>;
  cancelJob(jobId: string): Promise<unknown>;
  pickTake(jobId: string, takeFilmId: string): Promise<unknown>;
  revertScene(sceneId: string): Promise<unknown>;
  postVoice(blob: Blob): Promise<unknown>;
}
export const actionsFor = (filmId: string): CrewActions => ({
  postStoryboard: (ops) => postStoryboard(filmId, ops),
  cancelJob: (jobId) => cancelJob(filmId, jobId),
  pickTake: (jobId, takeFilmId) => pickTake(filmId, jobId, takeFilmId),
  revertScene: (sceneId) => revertScene(filmId, sceneId),
  postVoice: (blob) => postVoice(filmId, blob),
});
