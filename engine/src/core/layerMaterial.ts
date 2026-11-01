import * as THREE from 'three';
import { configure2DMaterial } from './stage';
import { createSoftLightMaterial } from './softLight';
import { applyBlendMode, type BlendMode } from './transform';

// The material a layer draws with. A soft-light layer blends into the frame behind it, so it gets
// the soft-light material; every other layer gets the usual unlit material.

export interface LayerMaterial {
  readonly material: THREE.Material;
  /** The layer's colour; a colour tween writes into it. */
  readonly color: THREE.Color;
  /** The layer's effective opacity (its own alpha times its ancestors'). */
  setAlpha(alpha: number): void;
  /** The frame behind the layer; only a soft-light material needs one. */
  setBackdrop?(texture: THREE.Texture, stage: { width: number; height: number }): void;
  dispose(): void;
}

export interface LayerMaterialOptions {
  blendMode: BlendMode;
  /** The layer's colour: a shape's fill, an image's tint. */
  color: string;
  /** The layer's own texture, when it draws one (an image, a text, a three layer's render target). */
  map?: THREE.Texture | null;
  /** true when the texture holds premultiplied colour (a three layer's render target). */
  premultiplied?: boolean;
}

export function createLayerMaterial(opts: LayerMaterialOptions): LayerMaterial {
  if (opts.blendMode === 'soft-light') {
    const soft = createSoftLightMaterial({
      color: opts.color,
      map: opts.map,
      premultiplied: opts.premultiplied,
    });
    configure2DMaterial(soft.material);
    applyBlendMode(soft.material, opts.blendMode);
    return {
      material: soft.material,
      color: soft.color,
      setAlpha: (alpha) => soft.setAlpha(alpha),
      setBackdrop: (texture, stage) => soft.setBackdrop(texture, stage),
      dispose: () => soft.dispose(),
    };
  }

  const material = new THREE.MeshBasicMaterial({ color: opts.color, map: opts.map ?? undefined });
  configure2DMaterial(material);
  applyBlendMode(material, opts.blendMode);
  return {
    material,
    color: material.color,
    setAlpha: (alpha) => {
      material.opacity = alpha;
    },
    dispose: () => material.dispose(),
  };
}
