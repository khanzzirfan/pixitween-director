// Owned by S13a. The RGBA pixel buffer the 3D image work runs on, and the few helpers around it.
export interface Rgba {
  width: number;
  height: number;
  /** RGBA, row by row, 4 bytes a pixel. */
  data: Uint8ClampedArray;
}

export const blank = (width: number, height: number): Rgba => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });
export function put(img: Rgba, x: number, y: number, rgb: readonly [number, number, number], a = 255): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = rgb[0];
  img.data[i + 1] = rgb[1];
  img.data[i + 2] = rgb[2];
  img.data[i + 3] = a;
}
export const alphaAt = (img: Rgba, x: number, y: number): number => img.data[(y * img.width + x) * 4 + 3]!;

