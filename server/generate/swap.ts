// Owned by S7b. Pure helpers that put a generated clip into a scene and take it out again.
import {
  addLayer, layerIdsByRole, registerAsset, removeLayer, reorderLayer, sceneInfo, secToFrames, setLayerHidden, setSceneDuration,
  type Comp,
} from '../authoring/api';

type Obj = Record<string, any>;

const HIDDEN_ROLES = ['bg', 'product', 'subject'] as const;

/** Scale the clip to cover the frame, centred. x,y is the TOP-LEFT (the authoring box convention). */
export function coverBox(frame: { width: number; height: number }, clip: { width: number; height: number }): { x: number; y: number; w: number; h: number } {
  const s = Math.max(frame.width / clip.width, frame.height / clip.height);
  const w = clip.width * s;
  const h = clip.height * s;
  return { x: (frame.width - w) / 2, y: (frame.height - h) / 2, w, h };
}

export function swapInClip(
  comp: Comp,
  o: { sceneId: string; asset: { id: string; url: string }; clipSec: number; frame: { width: number; height: number }; clipSize: { width: number; height: number } },
): Comp {
  const { sceneId } = o;
  const scene = sceneInfo(comp).find((s) => s.id === sceneId);
  let c = registerAsset(comp, { id: o.asset.id, kind: 'video', src: o.asset.url, width: o.clipSize.width, height: o.clipSize.height, duration: secToFrames(o.clipSec, comp.fps) });
  c = addLayer(c, { sceneId, role: 'clip', kind: 'video', assetId: o.asset.id, box: coverBox(o.frame, o.clipSize) });
  const clipId = `${sceneId}:clip`;

  const text = [...layerIdsByRole(c, 'headline', sceneId), ...layerIdsByRole(c, 'caption', sceneId)];
  const firstText = sceneInfo(c).find((s) => s.id === sceneId)!.layerIds.find((id) => text.includes(id));
  c = reorderLayer(c, clipId, firstText ? { below: firstText } : 'front');

  for (const role of HIDDEN_ROLES) for (const id of layerIdsByRole(c, role, sceneId)) c = setLayerHidden(c, id, true);
  // the "pending approval" caption has done its job: the real clip is in
  const meta = (c.meta as { director?: { layers?: Record<string, { sceneId: string; placeholder?: boolean }> } } | undefined)?.director?.layers ?? {};
  for (const [id, m] of Object.entries(meta)) if (m.sceneId === sceneId && m.placeholder) c = removeLayer(c, id);

  if (scene && o.clipSec >= 1 && o.clipSec < scene.durationSec - 0.2) c = setSceneDuration(c, sceneId, o.clipSec);
  return c;
}

const referenced = (c: Comp, assetId: string): boolean =>
  (c.layers as Obj[]).some((l) => l.assetId === assetId) ||
  Object.values((c.precomps ?? {}) as Record<string, Obj>).some((p) => (p.layers as Obj[]).some((l) => l.assetId === assetId));

export function revertToMotion(comp: Comp, sceneId: string, originalDurationSec: number): Comp {
  const clipId = `${sceneId}:clip`;
  let c = comp;
  const meta = (c.meta as { director?: { layers?: Record<string, { assetId?: string }> } } | undefined)?.director?.layers?.[clipId];
  if (meta) {
    const assetId = meta.assetId;
    c = removeLayer(c, clipId);
    if (assetId && !referenced(c, assetId)) {
      c = structuredClone(c);
      delete c.assets[assetId];
      for (const p of Object.values((c.precomps ?? {}) as Record<string, Obj>)) if (p.assets) delete p.assets[assetId];
    }
  }
  for (const role of HIDDEN_ROLES) for (const id of layerIdsByRole(c, role, sceneId)) c = setLayerHidden(c, id, false);

  const scene = sceneInfo(c).find((s) => s.id === sceneId);
  if (scene && Math.abs(scene.durationSec - originalDurationSec) > 0.01) c = setSceneDuration(c, sceneId, originalDurationSec);
  return c;
}
