// Ported from reacthub-pixitweenjs src/components/AepComposition/stage3d/dof.ts (MIT).
// Depth of field for a stage world: one full-screen pass gathers a disc of taps whose radius comes from
// each pixel's circle of confusion, so in-focus edges stay crisp and defocused objects bleed outward.
// It runs before the chain's tone mapping, as the library's pass did.
import { Pass } from 'postprocessing';
import * as THREE from 'three';

const TAPS = 32;
/** Blur radius in pixels at full aperture and maximum defocus, for a 720 px tall viewport. */
export const DOF_MAX_BLUR_PX = 18;

/** Circle-of-confusion radius in pixels: zero at the focus distance, growing with defocus and aperture. */
export function circleOfConfusion(distance: number, focusDistance: number, aperture: number, maxBlurPx = DOF_MAX_BLUR_PX): number {
  if (!(aperture > 0) || !(focusDistance > 0) || !(distance > 0)) return 0;
  const relative = Math.abs(distance - focusDistance) / Math.max(distance, focusDistance);
  return Math.min(maxBlurPx, maxBlurPx * aperture * relative * 2);
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <packing>
varying vec2 vUv;
uniform sampler2D inputBuffer;
uniform sampler2D depthBuffer;
uniform vec2 texel;
uniform float cameraNear;
uniform float cameraFar;
uniform float focusDistance;
uniform float aperture;
uniform float maxBlurPx;
uniform float bokeh;

float distanceAt(vec2 uv) {
  float depth = texture2D(depthBuffer, uv).x;
  return -perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
}

float cocAt(vec2 uv) {
  float d = distanceAt(uv);
  float rel = abs(d - focusDistance) / max(d, focusDistance);
  return min(maxBlurPx, maxBlurPx * aperture * rel * 2.0);
}

void main() {
  float radius = cocAt(vUv);
  vec4 sum = texture2D(inputBuffer, vUv);
  float weight = 1.0;
  if (radius > 0.5) {
    for (int i = 0; i < ${TAPS}; i++) {
      float fi = float(i);
      float r = sqrt((fi + 0.5) / ${TAPS}.0) * radius;
      float a = fi * 2.39996323;
      vec2 uv = vUv + vec2(cos(a), sin(a)) * r * texel;
      // A tap only spreads onto this pixel if its own blur reaches this far.
      float w = clamp(cocAt(uv) / max(r, 0.001), 0.0, 1.0);
      vec4 tap = texture2D(inputBuffer, uv);
      // bokeh: a bright tap counts for more, so a point of light spreads into a visible disc instead of a faint haze
      w *= 1.0 + bokeh * 6.0 * smoothstep(0.75, 1.6, dot(tap.rgb, vec3(0.2126, 0.7152, 0.0722)));
      sum += tap * w;
      weight += w;
    }
  }
  gl_FragColor = sum / weight;
}`;

export class StageDofPass extends Pass {
  private readonly material: THREE.ShaderMaterial;
  private readonly view: THREE.PerspectiveCamera | null;

  constructor(camera: THREE.Camera, aperture: number, focusDistance: number, bokeh = 0) {
    super('StageDofPass');
    this.needsDepthTexture = true;
    this.view = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera) : null;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        inputBuffer: { value: null },
        depthBuffer: { value: null },
        texel: { value: new THREE.Vector2() },
        cameraNear: { value: 0.05 },
        cameraFar: { value: 200 },
        focusDistance: { value: focusDistance },
        aperture: { value: aperture },
        maxBlurPx: { value: DOF_MAX_BLUR_PX },
        bokeh: { value: bokeh },
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

  get focusDistance(): number {
    return this.material.uniforms.focusDistance.value as number;
  }

  set focusDistance(value: number) {
    this.material.uniforms.focusDistance.value = value;
  }

  get aperture(): number {
    return this.material.uniforms.aperture.value as number;
  }

  set aperture(value: number) {
    this.material.uniforms.aperture.value = value;
  }

  /** How much bright points of light spread into discs (0 none, 1 strong). */
  get bokeh(): number {
    return this.material.uniforms.bokeh.value as number;
  }

  set bokeh(value: number) {
    this.material.uniforms.bokeh.value = value;
  }

  override setDepthTexture(depthTexture: THREE.Texture): void {
    this.material.uniforms.depthBuffer.value = depthTexture;
  }

  override setSize(width: number, height: number): void {
    const u = this.material.uniforms;
    u.texel.value.set(1 / width, 1 / height);
    // The blur radius is authored for a 720 px tall viewport.
    u.maxBlurPx.value = (DOF_MAX_BLUR_PX * height) / 720;
  }

  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget | null): void {
    const u = this.material.uniforms;
    u.inputBuffer.value = inputBuffer.texture;
    if (this.view) {
      u.cameraNear.value = this.view.near;
      u.cameraFar.value = this.view.far;
    }
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override dispose(): void {
    this.material.dispose();
    super.dispose();
  }
}
