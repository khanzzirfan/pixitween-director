import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// Shader transitions between a three layer's own shots, using the open gl-transitions collection
// (https://gl-transitions.com, MIT). Each transition is a GLSL `transition(uv)` function that mixes
// `getFromColor` and `getToColor` by `progress`. The layer renders two pictures for the window of a
// transition (the old shot's last camera pose, then the new shot), and this draws their mix.

export type TransitionParam = number | boolean | number[];

/** One entry of the gl-transitions package. */
export interface GlTransition {
  name: string;
  glsl: string;
  defaultParams: Record<string, TransitionParam>;
  paramsTypes: Record<string, string>;
}

export interface GlTransitionLib {
  find(name: string): GlTransition | undefined;
}

/** The package's list as a lookup. The module is loaded on first use (it is ~150 shaders), so a film with no transition never fetches it. */
export async function loadGlTransitions(): Promise<GlTransitionLib> {
  const mod = (await import('gl-transitions')) as unknown as { default?: GlTransition[] } & GlTransition[];
  const list: GlTransition[] = Array.isArray(mod.default) ? mod.default : (mod as unknown as GlTransition[]);
  const byName = new Map(list.map((t) => [t.name, t] as const));
  return { find: (name) => byName.get(name) };
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** The fragment shader for one transition: the spec's wrapper (texture lookups, progress, ratio) around its own `transition` function. */
export function transitionFragment(glsl: string): string {
  return /* glsl */ `
precision highp float;
uniform sampler2D from;
uniform sampler2D to;
uniform float progress;
uniform float ratio;
varying vec2 vUv;
vec4 getFromColor(vec2 uv) { return texture2D(from, uv); }
vec4 getToColor(vec2 uv) { return texture2D(to, uv); }
${glsl}
void main() { gl_FragColor = transition(vUv); }`;
}

const COPY_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D map;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(map, vUv); }`;

/** A uniform value for one declared param type; a missing or wrong value falls back to the transition's own default. */
export function uniformValue(type: string, value: TransitionParam | undefined, fallback: TransitionParam | undefined): unknown {
  const v = value ?? fallback;
  const arr = (n: number): number[] => (Array.isArray(v) && v.length === n ? v : Array.isArray(fallback) && fallback.length === n ? fallback : new Array<number>(n).fill(0));
  switch (type) {
    case 'float':
    case 'int':
      return typeof v === 'number' ? v : typeof fallback === 'number' ? fallback : 0;
    case 'bool':
      return typeof v === 'boolean' ? v : typeof fallback === 'boolean' ? fallback : false;
    case 'vec2':
    case 'ivec2':
      return new THREE.Vector2(...(arr(2) as [number, number]));
    case 'vec3':
      return new THREE.Vector3(...(arr(3) as [number, number, number]));
    case 'vec4':
      return new THREE.Vector4(...(arr(4) as [number, number, number, number]));
    default:
      return 0;
  }
}

/** Transitions that need a second picture (a displacement or luma map) cannot run here: nothing supplies it. */
export const usable = (t: GlTransition): boolean => !Object.values(t.paramsTypes).includes('sampler2D');

/**
 * Draws the mix of two textures into a render target, and copies a texture to a target. Owns a full-screen quad, a material per
 * transition (built the first time it is used) and the copy material.
 */
export class TransitionRenderer {
  private readonly quad = new FullScreenQuad();
  private readonly materials = new Map<string, THREE.ShaderMaterial>();
  private readonly copyMaterial = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: COPY_FRAGMENT, uniforms: { map: { value: null } }, depthTest: false, depthWrite: false, toneMapped: false });
  /** The picture the old shot ended on, held while the transition plays. */
  readonly from: THREE.WebGLRenderTarget;
  /** The mix, before it is copied back to the layer's own target. */
  readonly out: THREE.WebGLRenderTarget;

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    const opts = { type: THREE.HalfFloatType, depthBuffer: false } as const;
    this.from = new THREE.WebGLRenderTarget(width, height, opts);
    this.out = new THREE.WebGLRenderTarget(width, height, opts);
  }

  private material(def: GlTransition): THREE.ShaderMaterial {
    let m = this.materials.get(def.name);
    if (!m) {
      const uniforms: Record<string, { value: unknown }> = { from: { value: null }, to: { value: null }, progress: { value: 0 }, ratio: { value: this.width / this.height } };
      for (const [name, type] of Object.entries(def.paramsTypes)) uniforms[name] = { value: uniformValue(type, undefined, def.defaultParams[name]) };
      m = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: transitionFragment(def.glsl), uniforms, depthTest: false, depthWrite: false, toneMapped: false });
      this.materials.set(def.name, m);
    }
    return m;
  }

  private draw(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    const previous = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    renderer.autoClear = true;
    this.quad.material = material;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
    renderer.setRenderTarget(previous);
    renderer.autoClear = autoClear;
  }

  /** Copies `source` into `target` (used to hold the old shot's picture, and to put the mix back). */
  copy(renderer: THREE.WebGLRenderer, source: THREE.Texture, target: THREE.WebGLRenderTarget): void {
    this.copyMaterial.uniforms.map!.value = source;
    this.draw(renderer, this.copyMaterial, target);
  }

  /** The mix of `from` and `to` at `progress` (0 = all from, 1 = all to) with the transition's params over its defaults, in `out`. */
  mix(renderer: THREE.WebGLRenderer, def: GlTransition, to: THREE.Texture, progress: number, params: Record<string, TransitionParam> = {}): void {
    const m = this.material(def);
    m.uniforms.from!.value = this.from.texture;
    m.uniforms.to!.value = to;
    m.uniforms.progress!.value = Math.min(1, Math.max(0, progress));
    for (const [name, type] of Object.entries(def.paramsTypes)) m.uniforms[name]!.value = uniformValue(type, params[name], def.defaultParams[name]);
    this.draw(renderer, m, this.out);
  }

  dispose(): void {
    this.from.dispose();
    this.out.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.copyMaterial.dispose();
    this.quad.dispose();
  }
}
