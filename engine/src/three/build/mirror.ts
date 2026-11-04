import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

// A glossy floor: three's planar Reflector (the scene drawn again from the mirrored camera) with a shader of our own, so the
// reflection is soft, tinted and fades away from the product the way a lacquered studio floor does: strongest right under it, gone
// at `fade` metres. It is drawn over the floor with alpha, so the floor's own colour and the product's contact shadow stay.

export interface MirrorOptions {
  /** [width, depth] of the floor, metres; the product stands at its middle. */
  size: [number, number];
  /** How strong the reflection is where it is strongest, 0 to 1. */
  strength: number;
  /** The distance from the middle at which the reflection has faded out, metres. */
  fade: number;
  /** Softness of the reflection, 0 sharp to 1 very soft. */
  blur?: number;
  /** The size of the frame it is seen in, so the reflection picture matches its shape. */
  viewport: { width: number; height: number };
}

const VERTEX = /* glsl */ `
uniform mat4 textureMatrix;
varying vec4 vUv;
varying vec2 vLocal;
void main() {
  vUv = textureMatrix * vec4(position, 1.0);
  vLocal = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 color;
uniform sampler2D tDiffuse;
uniform float uStrength;
uniform float uFade;
uniform float uBlur;
varying vec4 vUv;
varying vec2 vLocal;
void main() {
  vec2 uv = vUv.xy / vUv.w;
  float dist = length(vLocal);
  float fade = 1.0 - smoothstep(0.0, uFade, dist);
  // softer the further from the product, like a polished floor
  float r = uBlur * (0.3 + 0.7 * clamp(dist / uFade, 0.0, 1.0));
  vec4 sum = texture2D(tDiffuse, uv) * 0.25;
  sum += texture2D(tDiffuse, uv + vec2( r, 0.0)) * 0.125;
  sum += texture2D(tDiffuse, uv + vec2(-r, 0.0)) * 0.125;
  sum += texture2D(tDiffuse, uv + vec2(0.0,  r)) * 0.125;
  sum += texture2D(tDiffuse, uv + vec2(0.0, -r)) * 0.125;
  sum += texture2D(tDiffuse, uv + vec2( r,  r) * 0.7) * 0.0625;
  sum += texture2D(tDiffuse, uv + vec2(-r,  r) * 0.7) * 0.0625;
  sum += texture2D(tDiffuse, uv + vec2( r, -r) * 0.7) * 0.0625;
  sum += texture2D(tDiffuse, uv + vec2(-r, -r) * 0.7) * 0.0625;
  gl_FragColor = vec4(sum.rgb * color * 2.0, sum.a * uStrength * fade * fade);
}`;

/** The reflection's alpha at `dist` metres from the middle (for tests and for the builder to reason about): 1 under the product, 0 at `fade`. */
export const mirrorFade = (dist: number, fade: number): number => {
  const x = Math.min(1, Math.max(0, dist / fade));
  const s = 1 - x * x * (3 - 2 * x);
  return s * s;
};

/** The mirror floor mesh, laid flat by the object's own rotation like a plane. Call `dispose()` on it when done. */
export function buildMirror(o: MirrorOptions): Reflector {
  const k = Math.min(1, 640 / Math.max(o.viewport.width, o.viewport.height));
  const reflector = new Reflector(new THREE.PlaneGeometry(o.size[0], o.size[1]), {
    color: new THREE.Color(0.5, 0.5, 0.5),
    textureWidth: Math.max(64, Math.round(o.viewport.width * k)),
    textureHeight: Math.max(64, Math.round(o.viewport.height * k)),
    multisample: 2,
    clipBias: 0.001,
    shader: {
      name: 'MirrorFloor',
      uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, uStrength: { value: o.strength }, uFade: { value: o.fade }, uBlur: { value: 0.004 + 0.012 * (o.blur ?? 0.5) } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    },
  });
  const material = reflector.material as THREE.ShaderMaterial;
  material.transparent = true;
  material.depthWrite = false;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  reflector.renderOrder = 0.5;
  return reflector;
}
