import * as THREE from 'three';

// Stage space (engine/docs/03-stage-2d.md): the doc is in pixels, origin top left, y down. Three is
// y-up, so the stage camera looks at (0, 0)..(width, -height) and doc y maps to world -y.

export function createStageCamera(width: number, height: number): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(0, width, 0, -height, -10000, 10000);
  camera.position.set(0, 0, 1000);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  return camera;
}

export const toWorldY = (docY: number): number => -docY;

/** Doc rotation is clockwise; Three's rotation.z is counter-clockwise. */
export const toWorldRotation = (clockwiseRadians: number): number => -clockwiseRadians;

/** 2D materials draw in layer order (renderOrder), never depth-tested, with exact sRGB colours. */
export function configure2DMaterial(material: THREE.Material): void {
  material.transparent = true;
  material.depthTest = false;
  material.depthWrite = false;
  material.toneMapped = false;
}
