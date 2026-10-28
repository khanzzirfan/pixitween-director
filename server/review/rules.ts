import type { Buffer } from 'node:buffer';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import type { Storyboard } from '@shared/storyboard';
import type { Finding, RuleDeps, SkipNote } from './types';
import { runRulesCore } from './rules-core';
import { makeSharpPixelDeps } from './pixels';
export const STUB_OWNER = 'S5a' as const;
export async function runRules(
  comp: AepCompositionJson,
  assets: { read(id: string): Promise<Buffer> } | null,
  o: { storyboard?: Storyboard; deps?: Partial<RuleDeps>; sceneIds?: string[]; safeInset?: number } = {},
): Promise<{ findings: Finding[]; skipped: SkipNote[] }> {
  const deps = { ...(assets ? makeSharpPixelDeps((id) => assets.read(id)) : {}), ...o.deps };
  return runRulesCore(comp, { ...o, deps });
}
export { layerBoxAt, listScenes, sampleSceneFrames, isProductVisible } from './geometry';
export { estimateTextSize } from './text-box';
export { makeSharpPixelDeps } from './pixels';
export { suggestFix, applyFixInMemory } from './fixes';
export { runRulesCore } from './rules-core';
export { GeometryError, round2, boxArea, boxH, boxW, intersect } from './types';
export type { Box, Finding, RuleDeps, SkipNote, Rule } from './types';
