import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import type { Finding, Box } from './types';
import { setSceneDuration, setText, setTransform } from '../authoring/api';
import type { Storyboard } from '@shared/storyboard';
import { isKeyframed } from './keyframes';
export interface FixContext {
  comp: AepCompositionJson;
  sceneId: string;
  boxes?: Record<string, Box>;
  storyboard?: Storyboard;
}
const firstValue = <T>(v: T | Array<{ v: T }>): T => (isKeyframed(v) ? (v as Array<{ v: T }>)[0]!.v : (v as T));

export function suggestFix(finding: Finding, ctx: FixContext): { tool: string; args: Record<string, unknown> } | undefined {
  const scene = ctx.comp.precomps?.[ctx.sceneId] as any;
  const layer = scene?.layers?.find((l: any) => l.id === finding.layerId);
  // keyframed positions are left alone; a static [x, y] position is the case these fixes move
  if (!layer || isKeyframed(layer.transform?.position) || layer.transform?.rotation !== 0) return undefined;
  if (finding.rule === 'R5' && finding.kind === 'scene-duration' && ctx.storyboard) {
    const s = ctx.storyboard.scenes.find((x) => x.id === ctx.sceneId);
    return s ? { tool: 'setSceneDuration', args: { sceneId: ctx.sceneId, sec: s.durationSec } } : undefined;
  }
  if (finding.rule === 'R2' && finding.kind === 'outside-safe-area') {
    const w = ctx.comp.width;
    const box = ctx.boxes?.[finding.layerId!];
    if (
      box &&
      box.left < 0.05 * w &&
      box.right > 0.95 * w &&
      layer.transform.anchor?.[0] / w >= 0.4 &&
      layer.transform.anchor?.[0] / w <= 0.6
    )
      return {
        tool: 'setTransform',
        args: { layerId: finding.layerId, scale: Math.floor((100 * 0.98 * 0.9 * w) / (box.right - box.left)) / 100 },
      };
    const y = layer.transform.position[1];
    const newY = box
      ? Math.max(
          box.top < 0.05 * ctx.comp.height ? y + (0.05 * ctx.comp.height - box.top) : y,
          Math.min(y, y + (0.95 * ctx.comp.height - box.bottom)),
        )
      : y;
    return newY !== y ? { tool: 'setTransform', args: { layerId: finding.layerId, y: newY } } : undefined;
  }
  if (finding.rule === 'R1' && finding.kind === 'text-over-product') {
    const box = ctx.boxes?.[finding.layerId!];
    const productId = Object.entries((ctx.comp.meta as any).director.layers).find(
      ([, v]: any) => v.sceneId === ctx.sceneId && v.role === 'product',
    )?.[0];
    const product = productId && scene.layers.find((l: any) => l.id === productId);
    if (!box || !product) return undefined;
    // an animated product is estimated from its first keyframe: the fix then sits clear of where the product starts
    const position = firstValue<[number, number]>(product.transform.position);
    const scale = firstValue<[number, number]>(product.transform.scale);
    const margin = ctx.comp.height * 0.02,
      ph = position[1],
      size = ((product.assetId ? (scene.assets as any)[product.assetId]?.height : undefined) ?? ctx.comp.height) * scale[1];
    const bottom = ph + size / 2 + margin;
    return { tool: 'setTransform', args: { layerId: finding.layerId, y: bottom + (box.bottom - box.top) / 2 } };
  }
  return undefined;
}
export function applyFixInMemory(comp: AepCompositionJson, fix: { tool: string; args: Record<string, unknown> }): AepCompositionJson {
  const a = fix.args as any;
  if (fix.tool === 'setTransform') return setTransform(comp, a.layerId, { x: a.x, y: a.y, scale: a.scale });
  if (fix.tool === 'setText') return setText(comp, a.layerId, a.text, a.style);
  if (fix.tool === 'setSceneDuration') return setSceneDuration(comp, a.sceneId, a.sec);
  throw new Error(`unsupported fix '${fix.tool}'`);
}
