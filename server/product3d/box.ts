// Owned by S13a. A carton from its front cut-out: the photo is the front face, the sides take the edge colour, the top is a little lighter (design section 5.2).
import { labToRgb, rgbToLab, sideColour } from './colour';
import type { Rgba } from './pixels';
import type { Rgb } from './unwrap';

export interface BoxFaces {
  /** The front face: the cut-out's own pixels, RGBA. */
  front: Uint8ClampedArray;
  frontSize: { width: number; height: number };
  side: Rgb;
  /** The side colour, 5 Lab lightness steps up: what the top face should read as. */
  top: Rgb;
}

/** How much lighter than the side the top is, in Lab L. */
export const TOP_LIGHTER_BY = 5;

export function boxFaces(img: Rgba): BoxFaces {
  const side = sideColour(img, { top: 0, bottom: img.height - 1, cx: img.width / 2, r: img.width / 2 });
  const [l, a, b] = rgbToLab(side);
  return {
    front: new Uint8ClampedArray(img.data),
    frontSize: { width: img.width, height: img.height },
    side,
    top: labToRgb([Math.min(100, l + TOP_LIGHTER_BY), a, b]),
  };
}
