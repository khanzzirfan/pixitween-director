// Ported from reacthub-pixitweenjs src/components/AepComposition/model3d/shadowFade.ts and framing.ts (MIT).
import * as THREE from 'three';

// The shadow catcher fades out toward its edge so a long shadow never ends in a hard line at the
// plane's edge. `r` is the distance from the plane's centre as a share of its half size (0 centre,
// 1 edge): full strength up to SHADOW_FADE_START, then a smooth fall to nothing at the edge. The
// shader patch below applies the same curve.

export const SHADOW_FADE_START = 0.3;

export function shadowEdgeFade(r: number): number {
  const t = Math.min(1, Math.max(0, (r - SHADOW_FADE_START) / (1 - SHADOW_FADE_START)));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Multiplies the shadow's alpha by the radial fade of `shadowEdgeFade` (the plane is 1 x 1 before
 * scaling, so its local xy is -0.5..0.5 and the distance from the centre doubles to a 0..1 share of
 * the half size). Wired through `ShadowMaterial.onBeforeCompile`.
 */
export function patchShadowEdgeFade(shader: { vertexShader: string; fragmentShader: string }): void {
  const start = SHADOW_FADE_START.toFixed(3);
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', 'varying vec2 vShadowPos;\nvoid main() {')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvShadowPos = position.xy;');
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', 'varying vec2 vShadowPos;\nvoid main() {')
    .replace(
      'gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );',
      `float shadowR = length( vShadowPos ) * 2.0;\n\tfloat shadowFade = 1.0 - smoothstep( ${start}, 1.0, shadowR );\n\tgl_FragColor = vec4( color, opacity * shadowFade * ( 1.0 - getShadowMask() ) );`,
    );
}

export interface ShadowCatcherOptions {
  opacity: number;
  y: number;
  size: number;
  /** Depth along z; defaults to `size` (a square catcher). */
  depth?: number;
}

/** A large horizontal plane that receives the key light's shadow with a soft radial edge. */
export function createShadowCatcher(options: ShadowCatcherOptions): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(options.size, options.depth ?? options.size);
  const material = new THREE.ShadowMaterial({ opacity: options.opacity, transparent: true });
  material.onBeforeCompile = patchShadowEdgeFade;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = options.y;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

const DEFAULT_SHADOW_RADIUS = 6;

/** Fit the key light's orthographic shadow camera to the objects' world-space box. */
export function fitShadowCamera(light: THREE.DirectionalLight, box: THREE.Box3): void {
  const radius = box.isEmpty()
    ? DEFAULT_SHADOW_RADIUS
    : Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 1e-3);
  const camera = light.shadow.camera;
  camera.left = -radius;
  camera.right = radius;
  camera.top = radius;
  camera.bottom = -radius;
  const distance = light.position.distanceTo(light.target.position);
  camera.near = Math.max(0.1, distance - radius * 1.5);
  camera.far = distance + radius * 1.5;
  camera.updateProjectionMatrix();
}
/**
 * Point the key light's shadow camera at a fixed square floor of half size `half` (a stage that objects
 * travel across), with a large map so the shadow stays sharp enough at that coverage.
 */
export function coverShadowCamera(light: THREE.DirectionalLight, half: number): void {
  const camera = light.shadow.camera;
  const bound = half * 1.1;
  camera.left = -bound;
  camera.right = bound;
  camera.top = bound;
  camera.bottom = -bound;
  camera.near = 0.5;
  camera.far = 40;
  camera.updateProjectionMatrix();
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.bias = -0.0005;
  light.shadow.normalBias = 0.02;
}
