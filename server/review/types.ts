export type Box = { left: number; top: number; right: number; bottom: number };
export type Rule = 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
export interface Finding {
  id: string;
  rule: Rule;
  kind: string;
  severity: 'error' | 'warn';
  sceneId: string;
  layerId?: string;
  atSec?: number;
  samplesFailing?: number[];
  evidence: string;
  metrics: Record<string, number | string>;
  suggestedFix?: { tool: string; args: Record<string, unknown> };
}
export interface RuleDeps {
  plateLuminance?(assetId: string, region: Box): Promise<number>;
  maskCoverage?(assetId: string, region: Box): Promise<number>;
  measuredTextBoxes?: Record<string, Box>;
}
export type SkipNote = { rule: Rule | '*'; sceneId?: string; reason: string };
export class GeometryError extends Error {
  constructor(
    readonly code: 'precomp-transform-unsupported' | 'unknown-layer' | 'unknown-scene' | 'text-size-unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'GeometryError';
  }
}
export const boxW = (b: Box) => b.right - b.left;
export const boxH = (b: Box) => b.bottom - b.top;
export const boxArea = (b: Box) => Math.max(0, boxW(b)) * Math.max(0, boxH(b));
export function intersect(a: Box, b: Box): Box | null {
  const out = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
  return out.right > out.left && out.bottom > out.top ? out : null;
}
export function round2(n: number): number {
  const v = (Math.sign(n) * Math.round(Math.abs(n) * 100)) / 100;
  return Object.is(v, -0) ? 0 : v;
}
