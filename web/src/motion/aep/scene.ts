// AEP layer list -> MotionDoc layer list. See engine/docs/10-aep-adapter.md
// ("Layers", precomp/audio/3D rows and the layer-order note) for the conversion
// rules this implements: layer order is kept (stored films are already back-first,
// like MotionDoc; the doc's "reverse" note was wrong, checked against a stored film), `precomp` layers become `group`s whose children are the precomp's
// own layers, `audio` layers are pulled out into cues instead
// of layers, `stage3d` worlds become one three layer (their `actor3d`/`prop3d` members
// are gathered into it, never separate layers), and any kind this converter doesn't
// understand is dropped with one warning naming the layer's id.
import type { AepLayer } from '@shared/aep/layer';
import type { AepAssetMap } from '@shared/aep/asset';
import type { AepCompositionJson } from '@shared/aep/composition';
import { rotationUnitOf, type AepRotationUnit } from '@shared/aep/rotation';
import { isStageMember, stageMembersOf } from '@shared/aep/stage3d';
import type { AepThemeMap } from '@shared/aep/theme';
import type { Layer, GroupLayer } from '@engine/schema';
import { convertShape, convertImage } from './layers2d';
import { convertText } from './text';
import { convertModel3D } from './model3d';
import { convertWorld } from './stage3d';
import { convertAudio, type AudioCue } from './audio';
import { mapBaseLayer } from './baseLayer';
import { sanitizeId } from './sanitizeId';
import type { ConvertedTween } from './keyframes';

export interface ConvertLayersOptions {
  resolveUrl?: (src: string) => string;
  /** The composition these layers belong to (text anchors are read against its size). */
  compSize?: { width: number; height: number };
  /** The unit the composition's layer rotations are written in ('rad' for a legacy film). */
  rotationUnit?: AepRotationUnit;
}

export interface ConvertLayersResult {
  layers: Layer[];
  warnings: string[];
  audio: AudioCue[];
}

function toEngineTweens(tweens: ConvertedTween[]): GroupLayer['tweens'] {
  return tweens.map((tween) => ({ ...tween, repeat: 0, yoyo: false }));
}

export function convertLayers(
  layers: AepLayer[],
  assets: AepAssetMap,
  precomps: Record<string, AepCompositionJson> | undefined,
  fps: number,
  theme?: AepThemeMap,
  opts: ConvertLayersOptions = {},
): ConvertLayersResult {
  const warnings: string[] = [];
  const audio: AudioCue[] = [];
  const emitted: Layer[] = [];

  for (const layer of layers) {
    // Stage3d members render only inside their world's 3D space; they are never
    // a top-level 2D layer, and the world itself already warns once below.
    if (isStageMember(layer)) continue;

    switch (layer.kind) {
      case 'shape': {
        const result = convertShape(layer, fps, theme, opts.compSize, opts.rotationUnit);
        warnings.push(...result.warnings);
        emitted.push(result.layer);
        break;
      }
      case 'image': {
        const result = convertImage(layer, fps, opts.compSize, opts.rotationUnit);
        warnings.push(...result.warnings);
        emitted.push(result.layer);
        break;
      }
      case 'text': {
        const result = convertText(layer, fps, theme, opts.compSize, opts.rotationUnit);
        warnings.push(...result.warnings);
        emitted.push(result.layer);
        break;
      }
      case 'model3d': {
        const result = convertModel3D(layer, fps, opts.rotationUnit);
        warnings.push(...result.warnings);
        if (result.layer) emitted.push(result.layer);
        break;
      }
      case 'stage3d': {
        const result = convertWorld(layer, stageMembersOf(layers, layer.id), { assets, fps, rotationUnit: opts.rotationUnit });
        warnings.push(...result.warnings);
        emitted.push(result.layer);
        break;
      }
      case 'audio': {
        const result = convertAudio(layer, assets, fps, opts.resolveUrl);
        warnings.push(...result.warnings);
        if (result.cue) audio.push(result.cue);
        break;
      }
      case 'precomp': {
        const nested = precomps?.[layer.compId];
        if (!nested) {
          warnings.push(`layer ${layer.id}: precomp '${layer.compId}' has no inline layers`);
          break;
        }
        // A precomp inherits its parent's rotation unit unless it declares its own.
        const nestedUnit = rotationUnitOf(nested, opts.rotationUnit ?? 'rad');
        const nestedResult = convertLayers(nested.layers, nested.assets, nested.precomps, nested.fps, nested.theme ?? theme, {
          ...opts,
          compSize: { width: nested.width, height: nested.height },
          rotationUnit: nestedUnit,
        });
        warnings.push(...nestedResult.warnings);
        audio.push(...nestedResult.audio);
        if (nestedResult.layers.length === 0) {
          warnings.push(`layer ${layer.id}: precomp '${layer.compId}' has no convertible layers`);
          break;
        }

        // The precomp layer itself lives in the parent composition, so it keeps the parent's unit.
        const { base, tweens, warnings: baseWarnings } = mapBaseLayer(layer, fps, opts.rotationUnit);
        warnings.push(...baseWarnings);

        const group: GroupLayer = {
          ...base,
          id: sanitizeId(layer.id),
          anchor: [0.5, 0.5],
          effects: [],
          tweens: toEngineTweens(tweens),
          type: 'group',
          children: nestedResult.layers,
        };
        emitted.push(group);
        break;
      }
      default:
        warnings.push(`layer ${layer.id}: unsupported layer kind '${layer.kind}'`);
    }
  }

  // Stored films list layers back first (the bg is layers[0]), same as MotionDoc: keep the order.
  return { layers: emitted, warnings, audio };
}
