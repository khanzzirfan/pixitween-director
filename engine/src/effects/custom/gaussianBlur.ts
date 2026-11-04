// The look of pixi.js's BlurFilter (v8 defaults: kernel 5, quality 4), which the AEP `gaussian-blur`
// effect used in the reacthub-pixitweenjs player. Its four halving passes of a 5-tap kernel add up to a
// Gaussian with sigma = PIXI_SIGMA_PER_STRENGTH * strength per axis, reaching 2 * strength past the
// layer's edge (the filter's padding). Here that Gaussian is one separable pass pair on a downsampled
// copy. Colour is blurred premultiplied and handed on straight, so transparent edges fade instead of
// darkening when the result is blended over what is behind it.
import { Pass } from 'postprocessing';
import * as THREE from 'three';

/** sqrt(sum w_k k^2) of pixi's 5-tap kernel [0.153388, 0.221461, 0.250301, ...]: the per-pass spread. */
export const PIXI_SIGMA_PER_STRENGTH = Math.sqrt(2 * (0.153388 * 4 + 0.221461 * 1));
/** At most this many taps either side of the centre, on the downsampled copy. */
const MAX_RADIUS = 24;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D inputBuffer;
uniform vec2 step;
uniform float sigma;
uniform int radius;
uniform bool premultiplyIn;
uniform bool unpremultiplyOut;
void main() {
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = -${MAX_RADIUS}; i <= ${MAX_RADIUS}; i++) {
    if (i < -radius || i > radius) continue;
    float x = float(i);
    float w = exp(-0.5 * x * x / (sigma * sigma));
    vec4 c = texture2D(inputBuffer, vUv + step * x);
    if (premultiplyIn) c.rgb *= c.a;
    sum += c * w;
    total += w;
  }
  vec4 color = sum / max(total, 1e-5);
  if (unpremultiplyOut) color.rgb /= max(color.a, 1e-4);
  gl_FragColor = color;
}`;

export class GaussianBlurPass extends Pass {
  /** Pixi BlurFilter strength, in pixels of the layer. */
  strength: number;
  private readonly a: THREE.WebGLRenderTarget;
  private readonly b: THREE.WebGLRenderTarget;
  private readonly material: THREE.ShaderMaterial;
  private width = 1;
  private height = 1;

  constructor(strength: number) {
    super('GaussianBlurPass');
    this.strength = strength;
    const options = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.a = new THREE.WebGLRenderTarget(1, 1, options);
    this.b = new THREE.WebGLRenderTarget(1, 1, options);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        inputBuffer: { value: null },
        step: { value: new THREE.Vector2() },
        sigma: { value: 1 },
        radius: { value: 1 },
        premultiplyIn: { value: false },
        unpremultiplyOut: { value: false },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.fullscreenMaterial = this.material;
  }

  /** How far the blur reaches past the layer's edge, like the pixi filter's padding. */
  static reach(strength: number): number {
    return Math.abs(strength) * 2;
  }

  override setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget | null): void {
    const sigma = Math.max(0, this.strength) * PIXI_SIGMA_PER_STRENGTH;
    const u = this.material.uniforms;
    if (sigma < 0.3) {
      // Nothing to blur: copy straight through.
      u.inputBuffer.value = inputBuffer.texture;
      u.step.value.set(0, 0);
      u.radius.value = 0;
      u.sigma.value = 1;
      u.premultiplyIn.value = false;
      u.unpremultiplyOut.value = false;
      renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
      renderer.render(this.scene, this.camera);
      return;
    }
    // Downsample so the kernel fits MAX_RADIUS taps; the blur hides the lower resolution.
    const factor = Math.max(1, Math.ceil((sigma * 3) / MAX_RADIUS));
    const w = Math.max(1, Math.round(this.width / factor));
    const h = Math.max(1, Math.round(this.height / factor));
    if (this.a.width !== w || this.a.height !== h) {
      this.a.setSize(w, h);
      this.b.setSize(w, h);
    }
    const s = sigma / factor;
    const radius = Math.min(MAX_RADIUS, Math.ceil(s * 3));
    u.sigma.value = s;
    u.radius.value = radius;

    // Horizontal, from the full-size input into the small target. Three's normal blending into a
    // cleared target already leaves colour premultiplied, so it is blurred as it is.
    u.inputBuffer.value = inputBuffer.texture;
    u.step.value.set(factor / this.width, 0);
    u.premultiplyIn.value = false;
    u.unpremultiplyOut.value = false;
    renderer.setRenderTarget(this.a);
    renderer.render(this.scene, this.camera);

    // Vertical.
    u.inputBuffer.value = this.a.texture;
    u.step.value.set(0, 1 / h);
    u.premultiplyIn.value = false;
    renderer.setRenderTarget(this.b);
    renderer.render(this.scene, this.camera);

    // Upsample into the output, back to straight alpha.
    u.inputBuffer.value = this.b.texture;
    u.step.value.set(0, 0);
    u.radius.value = 0;
    u.unpremultiplyOut.value = true;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override dispose(): void {
    this.a.dispose();
    this.b.dispose();
    this.material.dispose();
    super.dispose();
  }
}
