type Obj = Record<string, any>;
export function isSplitText(layer: Obj): boolean {
  const s = layer.style ?? {};
  return (
    (layer.splitMode !== undefined && layer.splitMode !== 'single') ||
    (layer.animators?.length ?? 0) > 0 ||
    (s.runs?.length ?? 0) > 0 ||
    String(s.align ?? '').startsWith('justify') ||
    Array.isArray(s.fill)
  );
}
export function advanceFactor(weight: unknown): number {
  return (typeof weight === 'number' && weight >= 700) || weight === 'bold' ? 0.6 : 0.55;
}
export function wrapWords(text: string, boxWidth: number, size: number, k: number): { w: number; h: number } {
  const words = text.split(/\s+/).filter(Boolean),
    space = size * k,
    lines: number[] = [];
  let width = 0;
  for (const word of words) {
    const w = word.length * size * k;
    if (width && width + space + w > boxWidth) {
      lines.push(width);
      width = w;
    } else width = width ? width + space + w : w;
  }
  if (width || !lines.length) lines.push(width);
  return { w: Math.max(...lines), h: lines.length * size * 1.2 };
}
export function estimateTextSize(layer: Obj): { w: number; h: number } {
  const style = layer.style ?? {};
  let size = style.size ?? 56;
  if (Array.isArray(size)) size = size[0]?.v ?? 56;
  const k = advanceFactor(style.weight),
    text = String(typeof layer.source === 'string' ? layer.source : (layer.source?.[0]?.v ?? ''));
  if (isSplitText(layer) && style.boxWidth) return wrapWords(text, style.boxWidth, size, k);
  const lines = text.split('\n');
  return { w: Math.max(0, ...lines.map((line) => line.length * size * k)), h: lines.length * size * 1.2 };
}
