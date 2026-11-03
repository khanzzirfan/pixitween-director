import * as THREE from 'three';

// Caustics: the rippling net of light a glass of liquid or a pool throws on the floor. A flat plane a hair above the ground, added on
// top of it (so it only ever brightens), strongest round the product and gone at `fade` metres. The pattern is the layered-ripple
// caustic from WaterThreeJS (github.com/achrefelouafi/WaterThreeJS, MIT): a closed-form function of position and time, so any frame
// can be drawn on its own and seeking gives the same picture.

export interface CausticsOptions {
  /** [width, depth] of the floor, metres; the product stands at its middle. */
  size: [number, number];
  /** How bright the light is where it is strongest, 0 to 1. */
  strength: number;
  /** The distance from the middle at which the light has faded out, metres. */
  fade: number;
  /** Ripples per metre: bigger is a finer net. */
  scale: number;
  color: string;
}

export interface CausticsRig {
  mesh: THREE.Mesh;
  setTime: (seconds: number) => void;
}

const VERTEX = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 color;
uniform float uTime;
uniform float uStrength;
uniform float uFade;
uniform float uScale;
varying vec2 vLocal;
float caustics(vec2 uv, float t) {
  vec2 p = mod(uv * 6.2831853, 6.2831853) - 250.0;
  vec2 i = vec2(p);
  float c = 1.0;
  float inten = 0.0045;
  for (int n = 0; n < 3; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 3.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.0);
}
void main() {
  vec2 uv = vLocal * uScale;
  // two nets drifting against each other, kept where both are bright: the sharp, knotted look of real caustics
  float c1 = caustics(uv * 0.13 + vec2(uTime * 0.04, 0.0), uTime * 0.6);
  float c2 = caustics(uv * 0.21 - vec2(0.0, uTime * 0.03) + 15.0, uTime * 0.8);
  float light = min(c1, c2) + 0.35 * c1 * c2;
  float d = clamp(length(vLocal) / uFade, 0.0, 1.0);
  float fade = 1.0 - d * d * (3.0 - 2.0 * d);
  gl_FragColor = vec4(color * light * uStrength * fade, 1.0);
}`;

/** The light's falloff at `dist` metres from the middle: 1 under the product, 0 at `fade` (a smoothstep, as the shader draws it). */
export const causticsFade = (dist: number, fade: number): number => {
  const d = Math.min(1, Math.max(0, dist / fade));
  return 1 - d * d * (3 - 2 * d);
};

/** The caustics plane, laid flat by its object's rotation like a plane ([-90, 0, 0]). */
export function buildCaustics(o: CausticsOptions): CausticsRig {
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      color: { value: new THREE.Color(o.color) },
      uTime: { value: 0 },
      uStrength: { value: o.strength },
      uFade: { value: o.fade },
      uScale: { value: o.scale },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(o.size[0], o.size[1]), material);
  mesh.renderOrder = 1;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  const setTime = (seconds: number): void => {
    material.uniforms.uTime!.value = seconds;
  };
  return { mesh, setTime };
}
