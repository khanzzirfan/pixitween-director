// The unit of a composition's 2D layer rotations.
//
// `meta.rotationUnit` says which unit `transform.rotation` is written in: 'deg' for every
// film made under the unit rule (the engine reads layer rotation in degrees), 'rad' for the
// legacy films the old Pixi player made (it read radians). A composition without the flag is
// a legacy film, so its rotations are radians.
export type AepRotationUnit = 'deg' | 'rad';

export const RAD_TO_DEG = 180 / Math.PI;

/**
 * The unit of a composition's rotations: its own `meta.rotationUnit`, or the unit it
 * inherits from its parent composition. A composition with no flag and no parent is a
 * legacy film, so its rotations are radians.
 */
export function rotationUnitOf(
  comp: { meta?: Record<string, unknown> },
  inherited: AepRotationUnit = 'rad',
): AepRotationUnit {
  const unit = comp.meta?.rotationUnit;
  return unit === 'deg' || unit === 'rad' ? unit : inherited;
}
