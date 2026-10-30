import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import type { Storyboard } from '@shared/storyboard';
import type { Finding, RuleDeps, SkipNote, Box } from './types';
import { boxArea, boxH, boxW, intersect, round2 } from './types';
import { layerBoxAt, listScenes, sampleSceneFrames, isProductVisible } from './geometry';
import { parseColor, relLuminance, ratioFromLuminance } from './contrast';

export async function runRulesCore(
  comp: AepCompositionJson,
  o: { storyboard?: Storyboard; deps?: RuleDeps; sceneIds?: string[]; safeInset?: number } = {},
): Promise<{ findings: Finding[]; skipped: SkipNote[] }> {
  const findings: Finding[] = [],
    skipped: SkipNote[] = [],
    d = (comp.meta as any)?.director ?? {},
    scenes = listScenes(comp).filter((s) => !o.sceneIds || o.sceneIds.includes(s.sceneId));
  const inset = o.safeInset ?? 0.05;
  for (const scene of scenes) {
    if (scene.mode === 'generate') {
      skipped.push({ rule: '*', sceneId: scene.sceneId, reason: 'generate-mode scene' });
      continue;
    }
    const inner = comp.precomps?.[scene.precompId] as any;
    const layers = inner.layers as any[];
    const metas = d.layers ?? {};
    const products = layers.filter((l) => metas[l.id]?.role === 'product' || metas[l.id]?.role === 'product3d');
    const texts = layers.filter((l) => l.kind === 'text');
    const samples = sampleSceneFrames(scene.durationFrames, 4);
    const box = (id: string, f: number) => layerBoxAt(comp, id, f, { measuredTextBox: o.deps?.measuredTextBoxes?.[id] });
    if (!products.length) {
      skipped.push({ rule: 'R1', sceneId: scene.sceneId, reason: 'no product layer' });
      skipped.push({ rule: 'R4', sceneId: scene.sceneId, reason: 'no product layer' });
    }
    for (const text of texts) {
      const per: { frame: number; cov: number; tb: Box; pb: Box; behind: boolean }[] = [];
      for (const f of samples) {
        const tb = box(text.id, f);
        if (!tb.visible || tb.opacity < 0.3) continue;
        const product = products[0];
        if (!product) continue;
        const pb = box(product.id, f);
        if (!isProductVisible(pb, { w: scene.width, h: scene.height })) continue;
        const overlap = intersect(tb.box, pb.box);
        let coverage = overlap ? boxArea(overlap) / Math.max(1, boxArea(tb.box)) : 0;
        const maskId = metas[product.id]?.maskAssetId;
        if (maskId && o.deps?.maskCoverage && overlap) {
          const reg = {
            left: (overlap.left - pb.box.left) / boxW(pb.box),
            top: (overlap.top - pb.box.top) / boxH(pb.box),
            right: (overlap.right - pb.box.left) / boxW(pb.box),
            bottom: (overlap.bottom - pb.box.top) / boxH(pb.box),
          };
          coverage = await o.deps.maskCoverage(maskId, reg);
        }
        const behind = tb.drawIndex < pb.drawIndex;
        const limit = behind ? 0.4 : 0.15;
        if (coverage > limit) per.push({ frame: f, cov: coverage, tb: tb.box, pb: pb.box, behind });
      }
      if (per.length) {
        const worst = per.reduce((a, b) => (a.cov >= b.cov ? a : b));
        const kind = worst.behind ? 'text-occluded' : 'text-over-product';
        findings.push({
          id: `R1:${text.id}:${kind}`,
          rule: 'R1',
          kind,
          severity: 'error',
          sceneId: scene.sceneId,
          layerId: text.id,
          atSec: round2(worst.frame / scene.fps),
          samplesFailing: per.map((x) => round2(x.frame / scene.fps)),
          metrics: { coverage: round2(worst.cov), limit: worst.behind ? 0.4 : 0.15 },
          evidence: worst.behind
            ? `headline '${text.id}' is ${(worst.cov * 100).toFixed(1)}% hidden behind the product at ${(worst.frame / scene.fps).toFixed(2)} s (limit 40%)`
            : `text '${text.id}' covers ${(worst.cov * 100).toFixed(1)}% of its area with the product at ${(worst.frame / scene.fps).toFixed(2)} s (text ${Math.round(worst.tb.left)},${Math.round(worst.tb.top)} → ${Math.round(worst.tb.right)},${Math.round(worst.tb.bottom)}; product ${Math.round(worst.pb.left)},${Math.round(worst.pb.top)} → ${Math.round(worst.pb.right)},${Math.round(worst.pb.bottom)})`,
        });
      }
      let overflow: { f: number; values: number[]; box: Box } | undefined;
      for (const f of samples) {
        const b = box(text.id, f);
        if (!b.visible || b.opacity < 0.3) continue;
        const vals = [
          Math.max(0, inset * scene.width - b.box.left),
          Math.max(0, b.box.right - (1 - inset) * scene.width),
          Math.max(0, inset * scene.height - b.box.top),
          Math.max(0, b.box.bottom - (1 - inset) * scene.height),
        ];
        if (vals.some(Boolean) && (!overflow || vals.reduce((x, y) => x + y, 0) > overflow.values.reduce((x, y) => x + y, 0)))
          overflow = { f, values: vals, box: b.box };
      }
      if (overflow) {
        const [l, r, t, b] = overflow.values;
        const sides = [
          l && `${Math.round(l)} px past the left`,
          r && `${Math.round(r)} px past the right`,
          t && `${Math.round(t)} px past the top`,
          b && `${Math.round(b)} px past the bottom`,
        ].filter(Boolean);
        findings.push({
          id: `R2:${text.id}:outside-safe-area`,
          rule: 'R2',
          kind: 'outside-safe-area',
          severity: 'error',
          sceneId: scene.sceneId,
          layerId: text.id,
          atSec: round2(overflow.f / scene.fps),
          metrics: { overflowLeft: round2(l!), overflowRight: round2(r!), overflowTop: round2(t!), overflowBottom: round2(b!) },
          evidence: `text '${text.id}' extends ${sides.join(' and ')} safe edge at ${(overflow.f / scene.fps).toFixed(2)} s (safe ${Math.round(inset * scene.width)},${Math.round(inset * scene.height)} → ${Math.round((1 - inset) * scene.width)},${Math.round((1 - inset) * scene.height)})`,
        });
      }
      const stroke = (text.style as any)?.stroke;
      if (stroke?.width >= 2) {
        skipped.push({ rule: 'R3', sceneId: scene.sceneId, reason: 'text has a stroke' });
        continue;
      }
      const bg = layers.find((l) => metas[l.id]?.role === 'bg');
      if (!bg) {
        skipped.push({ rule: 'R3', sceneId: scene.sceneId, reason: 'bg layer is rotated or not an image or flat shape' });
        continue;
      }
      let worstRatio = Infinity,
        worstLum = 0,
        worstF = 0;
      let valid = false;
      for (const f of samples) {
        const tb = box(text.id, f);
        if (!tb.visible || tb.opacity < 0.3) continue;
        const bb = box(bg.id, f);
        let lum: number;
        if (bg.kind === 'shape' && typeof bg.fill === 'string') {
          lum = relLuminance(parseColor(bg.fill));
        } else if (bg.kind === 'image' && o.deps?.plateLuminance) {
          const overlap = intersect(tb.box, bb.box);
          if (!overlap) continue;
          const region = {
            left: (overlap.left - bb.box.left) / boxW(bb.box),
            top: (overlap.top - bb.box.top) / boxH(bb.box),
            right: (overlap.right - bb.box.left) / boxW(bb.box),
            bottom: (overlap.bottom - bb.box.top) / boxH(bb.box),
          };
          lum = await o.deps.plateLuminance(bg.assetId, region);
        } else {
          skipped.push({
            rule: 'R3',
            sceneId: scene.sceneId,
            reason: bg.kind === 'image' ? 'plate pixel sampler not provided' : 'bg layer is rotated or not an image or flat shape',
          });
          break;
        }
        const raw = (text.style as any)?.fill ?? '#ffffff';
        const color = typeof raw === 'string' ? raw : (raw.default ?? '#ffffff');
        const ratio = ratioFromLuminance(relLuminance(parseColor(color)), lum);
        if (ratio < worstRatio) {
          worstRatio = ratio;
          worstLum = lum;
          worstF = f;
          valid = true;
        }
      }
      if (valid && worstRatio < 4.5)
        findings.push({
          id: `R3:${text.id}:low-contrast`,
          rule: 'R3',
          kind: 'low-contrast',
          severity: 'error',
          sceneId: scene.sceneId,
          layerId: text.id,
          atSec: round2(worstF / scene.fps),
          metrics: { ratio: round2(worstRatio), plateLuminance: round2(worstLum), required: 4.5 },
          evidence: `contrast ${worstRatio.toFixed(2)}:1 (text ${(text.style as any)?.fill ?? '#ffffff'} on plate luminance ${worstLum.toFixed(2)}; need 4.5:1) at ${(worstF / scene.fps).toFixed(2)} s`,
        });
    }
    if (products.length) {
      const p = products[0]!;
      const pass = samples.filter((f) => isProductVisible(box(p.id, f), { w: scene.width, h: scene.height }));
      if (pass.length / samples.length < 0.6)
        findings.push({
          id: `R4:${p.id}:product-hidden`,
          rule: 'R4',
          kind: 'product-hidden',
          severity: 'error',
          sceneId: scene.sceneId,
          layerId: p.id,
          atSec: round2((samples.find((f) => !pass.includes(f)) ?? samples[0]!) / scene.fps),
          samplesFailing: samples.filter((f) => !pass.includes(f)).map((f) => round2(f / scene.fps)),
          metrics: { visibleSamples: pass.length, samples: samples.length, fraction: round2(pass.length / samples.length), limit: 0.6 },
          evidence: `product visible in ${pass.length} of ${samples.length} samples (${Math.round((pass.length / samples.length) * 100)}% < 60%)`,
        });
    }
    for (const layer of layers)
      if (layer.outPoint > scene.durationFrames)
        findings.push({
          id: `R5:${scene.sceneId}:layer-outlasts-scene:${layer.id}`,
          rule: 'R5',
          kind: 'layer-outlasts-scene',
          severity: 'warn',
          sceneId: scene.sceneId,
          layerId: layer.id,
          metrics: { outPoint: layer.outPoint, sceneFrames: scene.durationFrames },
          evidence: `layer ${layer.id} outlasts scene ${scene.sceneId}`,
        });
    const sb = o.storyboard?.scenes.find((s) => s.id === scene.sceneId);
    if (sb) {
      const expected = Math.round(sb.durationSec * scene.fps);
      if (Math.abs(scene.durationFrames - expected) > 1)
        findings.push({
          id: `R5:${scene.sceneId}:scene-duration`,
          rule: 'R5',
          kind: 'scene-duration',
          severity: 'error',
          sceneId: scene.sceneId,
          metrics: { sceneFrames: scene.durationFrames, storyboardFrames: expected },
          evidence: `scene ${scene.sceneId} lasts ${scene.durationFrames} frames but the storyboard says ${sb.durationSec.toFixed(1)} s (${expected} frames)`,
        });
    }
  }
  const ordered = listScenes(comp);
  let expected = 0;
  for (const s of ordered) {
    const root = (comp.layers as any[]).find((l) => l.kind === 'precomp' && l.compId === s.precompId);
    if (root && root.inPoint !== expected) {
      const gap = root.inPoint - expected;
      findings.push({
        id: `R5:${s.sceneId}:${gap > 0 ? 'scene-gap' : 'scene-overlap'}`,
        rule: 'R5',
        kind: gap > 0 ? 'scene-gap' : 'scene-overlap',
        severity: 'error',
        sceneId: s.sceneId,
        metrics: { startFrame: root.inPoint, expectedFrame: expected, deltaFrames: Math.abs(gap) },
        evidence: `scene ${s.sceneId} starts at frame ${root.inPoint}, expected ${expected} (${gap > 0 ? 'gap' : 'overlap'} of ${Math.abs(gap)} frames)`,
      });
    }
    expected += s.durationFrames;
  }
  if (ordered.length) {
    const last = ordered.at(-1)!.sceneId;
    const totalStory = o.storyboard?.durationSec;
    if (comp.durationInFrames !== expected || (totalStory !== undefined && totalStory > 30))
      findings.push({
        id: `R5:${last}:total-duration`,
        rule: 'R5',
        kind: 'total-duration',
        severity: 'error',
        sceneId: last,
        metrics: { rootFrames: comp.durationInFrames, sceneFrames: expected, storyboardSeconds: totalStory ?? 0 },
        evidence: `film duration ${comp.durationInFrames} frames does not match ${expected} scene frames`,
      });
  }
  findings.sort(
    (a, b) =>
      ordered.findIndex((s) => s.sceneId === a.sceneId) - ordered.findIndex((s) => s.sceneId === b.sceneId) ||
      a.rule.localeCompare(b.rule) ||
      (a.layerId ?? '').localeCompare(b.layerId ?? '') ||
      a.id.localeCompare(b.id),
  );
  return {
    findings: findings.map((f) => ({
      ...f,
      metrics: Object.fromEntries(Object.entries(f.metrics).map(([k, v]) => [k, typeof v === 'number' ? round2(v) : v])),
    })),
    skipped,
  };
}
