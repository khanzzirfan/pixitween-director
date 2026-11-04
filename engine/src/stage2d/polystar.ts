// A polystar shape (engine/docs/03-stage-2d.md): a star or a polygon drawn from its points.

/** A corner of a polystar, in the doc's shape space: the origin is the centre and y grows downwards. */
export interface PolystarCorner {
  x: number;
  y: number;
}

export interface PolystarSpec {
  /** The number of tips. A star has that many tips and as many inner corners. */
  points: number;
  /** The distance from the centre to a tip. */
  outerRadius: number;
  /** The distance from the centre to an inner corner. A polygon ignores it. */
  innerRadius?: number;
  starType?: 'star' | 'polygon';
}

/**
 * The corners of a polystar, centred on the origin in the doc's shape space (y down): the first
 * corner is straight up and the rest go clockwise, the way After Effects draws a star. A star
 * alternates the outer radius and the inner radius and has twice as many corners as it has tips; a
 * polygon puts every corner on the outer radius and has one corner per tip.
 */
export function polystarCorners(spec: PolystarSpec): PolystarCorner[] {
  const tips = Math.max(3, Math.round(spec.points));
  const polygon = spec.starType === 'polygon';
  const outer = spec.outerRadius;
  const inner = polygon ? outer : Math.min(spec.innerRadius ?? outer, outer);
  const count = polygon ? tips : tips * 2;
  const step = (2 * Math.PI) / count;
  const corners: PolystarCorner[] = [];
  for (let i = 0; i < count; i++) {
    const radius = polygon || i % 2 === 0 ? outer : inner;
    // The angle is measured clockwise from straight up, so the first corner is at the top.
    const angle = i * step;
    corners.push({ x: radius * Math.sin(angle), y: -radius * Math.cos(angle) });
  }
  return corners;
}

/**
 * The same star pulled in by a stroke's width, so the stroke can be drawn as a ring (the outline
 * with this copy carved out of it). A stroke wider than the star's inner radius would close the
 * copy on itself, so the inner corners keep a sliver of the star.
 */
export function insetPolystar(spec: PolystarSpec, width: number): PolystarSpec {
  const outerRadius = spec.outerRadius - width;
  const innerRadius = spec.starType === 'polygon' ? outerRadius : Math.max((spec.innerRadius ?? spec.outerRadius) - width, outerRadius * 0.02);
  return { ...spec, outerRadius, innerRadius };
}
