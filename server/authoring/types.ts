import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import type { Aspect } from '@shared/composition';

export type { Aspect };
export type Comp = AepCompositionJson;
export type LayerRole = 'bg' | 'product' | 'subject' | 'headline' | 'caption' | 'camera' | 'clip' | 'product3d';
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
  /** A 3D product layer remembers the 2D product layer it replaced, so switching back restores it exactly (S13). */
  was?: { layer: Record<string, any>; meta: Omit<LayerMeta, 'was'> };
}

export interface DirectorMeta {
  productNoun?: string;
  /** The packaging shape of the product in the photo (S13): what 3D shape to build. */
  productShape?: 'can' | 'bottle' | 'box' | 'jar' | 'tube' | 'pouch' | 'other';
  scenes: Record<string, SceneMeta>;
  layers: Record<string, LayerMeta>;
}

/** Loose view of a layer for the pure functions; the engine validates the result on commit. */
export type Obj = Record<string, any>;
