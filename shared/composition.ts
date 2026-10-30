import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import type { StyleBible } from './crew';
import type { Storyboard } from './storyboard';

export type FilmId = string;
export type Aspect = '16:9' | '9:16' | '1:1';

export interface AssetRef {
  id: string;
  url: string;
  mime: string;
  width?: number;
  height?: number;
  role?: 'product-photo' | 'plate' | 'still' | 'cutout' | 'mask' | 'clip' | 'frame' | 'audio' | 'label';
  sceneId?: string;
  /** Review frames only: the film they were captured for, the time they show and whether they are before or after a fix. */
  filmId?: FilmId;
  atSec?: number;
  phase?: 'before' | 'after';
  /** Review frames only: one capture request; the newest batch per scene is the one reviewed. */
  batch?: string;
}

export interface FilmVersion {
  version: number;
  composition: AepCompositionJson;
  source: 'director' | 'review' | 'chat' | 'generate' | 'user';
  note?: string;
  at: string;
}

export interface FilmState {
  id: FilmId;
  title?: string;
  aspect: Aspect;
  status: 'new' | 'planning' | 'building' | 'reviewing' | 'ready' | 'failed';
  brief: { text: string; transcript?: string; productAssetId: string };
  storyboard?: Storyboard;
  version: number;
  composition?: AepCompositionJson;
  assets: AssetRef[];
  costUsd: number; // derived from the Ledger
  clippyCredits: number; // derived from the Ledger
  createdAt: string; // ISO; the gallery sorts newest first
  crew?: boolean; // run by the showrunner and the job board (S12)
  parentId?: FilmId; // set on a take's child film
  styleBible?: StyleBible;
  storyboardRev?: number;
}

export const FILM_FPS = 30;

export const ASPECT_SIZES: Record<Aspect, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

export const FILM_ID_RE = /^film_[a-f0-9]{12}$/;
// Unguessable 128-bit hex: GET /api/assets/:id is unauthenticated.
export const ASSET_ID_RE = /^ast_[a-f0-9]{32}$/;

export const isFilmId = (x: unknown): x is FilmId => typeof x === 'string' && FILM_ID_RE.test(x);
export const isAssetId = (x: unknown): x is string => typeof x === 'string' && ASSET_ID_RE.test(x);
