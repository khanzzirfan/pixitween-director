import { alphaAt, type Rgba } from './pixels';

// Where the label is on a flat product: the macro shot puts its camera there. A label, a logo or printed text is small, sharp detail with strokes
// in both directions, where a hinge, a seam or a stripe is a long edge in one. So the picture is cut into a grid and each cell counts the
// strokes across it in the weaker of the two directions (where a run of hard brightness steps starts, horizontally and vertically); the best spot, counting only cells
// on the product, is the focus. Pure: it takes pixels.

/** The grid is this many cells on each side; the focus is the best 2 x 2 block of cells, so it is a spot, not a single noisy cell. */
const GRID = 12;
/** A cell counts only when at least this share of it lies on the product. */
const COVER = 0.7;
/** A pixel is on the product when its alpha is at least this. */
const SOLID = 128;
/** A change of brightness between neighbours is a step above this (0-255): printed ink on a surface is a hard step, the shading of a moulded part a soft one. */
const STEP = 24;

const luma = (d: Uint8ClampedArray | Uint8Array, i: number): number => 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;

/**
 * The most detailed spot of a front picture, as [u, v] shares of its width and height (v counts down from the top): [0.5, 0.5] when the
 * picture is too small, empty, or has no detail anywhere.
 */
export function detailFocus(img: Rgba): [number, number] {
  const { width: w, height: h, data } = img;
  if (w < GRID * 2 || h < GRID * 2) return [0.5, 0.5];
  const edgeX = new Float64Array(GRID * GRID);
  const edgeY = new Float64Array(GRID * GRID);
  const solid = new Float64Array(GRID * GRID);
  const count = new Float64Array(GRID * GRID);
  // a step is a hard change of brightness to the next pixel; what is counted is where a run of steps STARTS, so a long edge or a soft shaded
  // curve is one crossing, and a letter, a logo or a barcode, with its many strokes, is many
  const stepX = new Uint8Array(w * h);
  const stepY = new Uint8Array(w * h);
  for (let y = 0; y < h - 1; y++) {
    const gy = Math.min(GRID - 1, Math.floor((y / h) * GRID));
    for (let x = 0; x < w - 1; x++) {
      const gx = Math.min(GRID - 1, Math.floor((x / w) * GRID));
      const cell = gy * GRID + gx;
      count[cell]!++;
      const i = (y * w + x) * 4;
      if (alphaAt(img, x, y) < SOLID) continue;
      solid[cell]!++;
      // both neighbours on the product, so the product's own outline is not read as detail
      if (alphaAt(img, x + 1, y) < SOLID || alphaAt(img, x, y + 1) < SOLID) continue;
      const here = y * w + x;
      if (Math.abs(luma(data, i) - luma(data, i + 4)) > STEP) {
        stepX[here] = 1;
        if (x === 0 || !stepX[here - 1]) edgeX[cell]!++;
      }
      if (Math.abs(luma(data, i) - luma(data, i + w * 4)) > STEP) {
        stepY[here] = 1;
        if (y === 0 || !stepY[here - w]) edgeY[cell]!++;
      }
    }
  }
  const score = (gx: number, gy: number): number => {
    let sx = 0;
    let sy = 0;
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const cell = (gy + dy) * GRID + gx + dx;
        if (solid[cell]! / Math.max(1, count[cell]!) < COVER) return 0;
        sx += edgeX[cell]!;
        sy += edgeY[cell]!;
      }
    }
    // strokes in both directions: the weaker direction decides, so a long straight edge (one direction) cannot win
    return Math.min(sx, sy);
  };
  let best = 0;
  let at: [number, number] = [0.5, 0.5];
  for (let gy = 0; gy < GRID - 1; gy++) {
    for (let gx = 0; gx < GRID - 1; gx++) {
      const s = score(gx, gy);
      if (s > best) {
        best = s;
        at = [(gx + 1) / GRID, (gy + 1) / GRID];
      }
    }
  }
  return [Math.round(at[0] * 1000) / 1000, Math.round(at[1] * 1000) / 1000];
}
