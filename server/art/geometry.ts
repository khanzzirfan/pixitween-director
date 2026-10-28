export type Box = { left: number; top: number; right: number; bottom: number };
export type Rect = { x: number; y: number; w: number; h: number };
export function trimBox(bounds: Box, imgW: number, imgH: number): Box {
  const w = bounds.right - bounds.left,
    h = bounds.bottom - bounds.top;
  const m = Math.max(2, Math.round(0.01 * Math.max(w, h)));
  return {
    left: Math.max(0, bounds.left - m),
    top: Math.max(0, bounds.top - m),
    right: Math.min(imgW, bounds.right + m),
    bottom: Math.min(imgH, bounds.bottom + m),
  };
}
export function coverBox(img: { w: number; h: number }, comp: { w: number; h: number }, overscan = 1): Rect {
  const s = Math.max(comp.w / img.w, comp.h / img.h) * overscan;
  const w = img.w * s,
    h = img.h * s;
  return { x: (comp.w - w) / 2, y: (comp.h - h) / 2, w, h };
}
export function productBox(
  img: { w: number; h: number },
  comp: { w: number; h: number },
  opts: { heightFrac?: number; cx?: number; baseline?: number } = {},
): Rect {
  const heightFrac = opts.heightFrac ?? 0.6,
    cx = opts.cx ?? 0.5,
    baseline = opts.baseline ?? 0.82;
  let h = comp.h * heightFrac,
    w = (img.w * h) / img.h;
  if (w > 0.8 * comp.w) {
    w = 0.8 * comp.w;
    h = (w * img.h) / img.w;
  }
  return { x: comp.w * cx - w / 2, y: comp.h * baseline - h, w, h };
}
