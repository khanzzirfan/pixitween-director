import type { TextStyle } from '../../schema/layers2d';
import { cssFont, type TextLayout } from './layout';

const DEG_TO_RAD = Math.PI / 180;

/**
 * Draws a laid-out text block on a 2D canvas at `pixelRatio`, resizing `ctx.canvas` to fit the
 * layout plus `padding` on every side. Drawing order (engine/docs/03-stage-2d.md): shadow, then
 * stroke (`lineJoin: 'round'`), then fill — all offset by `padding` so nothing is clipped.
 */
export function drawText(ctx: CanvasRenderingContext2D, layout: TextLayout, style: TextStyle, pixelRatio: number, padding: number): void {
  const canvas = ctx.canvas;
  canvas.width = Math.ceil((layout.width + padding * 2) * pixelRatio);
  canvas.height = Math.ceil((layout.height + padding * 2) * pixelRatio);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.font = cssFont(style);
  ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = `${style.letterSpacing}px`;

  if (style.dropShadow) {
    const shadow = style.dropShadow;
    const angle = shadow.angle * DEG_TO_RAD;
    ctx.shadowColor = shadow.color;
    ctx.shadowBlur = shadow.blur;
    ctx.shadowOffsetX = Math.cos(angle) * shadow.distance;
    ctx.shadowOffsetY = Math.sin(angle) * shadow.distance;
  }

  if (style.stroke) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = style.stroke.width;
    ctx.strokeStyle = style.stroke.color;
    for (const line of layout.lines) {
      ctx.strokeText(line.text, line.x + padding, line.y + padding);
    }
  }

  ctx.fillStyle = style.fill;
  for (const line of layout.lines) {
    ctx.fillText(line.text, line.x + padding, line.y + padding);
  }
}
