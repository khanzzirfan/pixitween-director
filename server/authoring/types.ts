import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import type { Aspect } from '@shared/composition';

export type { Aspect };
export type Comp = AepCompositionJson;
export type LayerRole = 'bg' | 'product' | 'subject' | 'headline' | 'caption' | 'camera' | 'clip';
export type Prop = 'x' | 'y' | 'scale' | 'rotation' | 'opacity';
export type Ease = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
export type CameraMove = 'static' | 'dolly-in' | 'pan' | 'orbit' | 'parallax';

export interface StyleArg {
  font?: string;
  size?: number;
  color?: string;
  weight?: number;
  align?: 'left' | 'center' | 'right';
  boxWidth?: number;
}

export interface SceneMeta {
  precompId: string;
  startFrame: number;
  durationFrames: number;
  mode: 'motion' | 'generate';
  intent?: string;
  camera?: { move: CameraMove; strength: number };
}

export interface LayerMeta {
  sceneId: string;
  role: LayerRole;
  assetId?: string;
  maskAssetId?: string;
  z?: number;
  base?: { x: number; y: number; scale: number };
  placeholder?: boolean;
}

export interface DirectorMeta {
  productNoun?: string;
  scenes: Record<string, SceneMeta>;
  layers: Record<string, LayerMeta>;
}

/** Loose view of a layer for the pure functions; the engine validates the result on commit. */
export type Obj = Record<string, any>;
