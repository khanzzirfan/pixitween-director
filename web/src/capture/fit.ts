export interface Size {
  w: number;
  h: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface FitTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** How the composition is drawn inside the stage: `screen` is the stage in pixels, `comp` the film's frame size. */
export function fitTransform(screen: Size, comp: Size): FitTransform {
  const scale = Math.min(screen.w / comp.w, screen.h / comp.h);
  return {
    scale,
    offsetX: (screen.w - comp.w * scale) / 2,
    offsetY: (screen.h - comp.h * scale) / 2,
  };
}

/** Converts a rectangle in stage pixels into composition pixels. */
export function toCompSpace(r: Rect, t: FitTransform): { left: number; top: number; right: number; bottom: number } {
  return {
    left: (r.x - t.offsetX) / t.scale,
    top: (r.y - t.offsetY) / t.scale,
    right: (r.x + r.width - t.offsetX) / t.scale,
    bottom: (r.y + r.height - t.offsetY) / t.scale,
  };
}
