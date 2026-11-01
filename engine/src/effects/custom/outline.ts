// Ported from node_modules/pixi-filters/lib/outline/outline.frag (MIT, read only; not imported).
// Samples the input alpha at 16 directions at `thickness` px and, where the centre pixel is
// transparent but a neighbour is opaque, draws `color` at `alpha` for the outline ring.
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import * as THREE from 'three';

export interface OutlineEffect2DOptions {
  color?: string;
  thickness?: number;
  alpha?: number;
  blendFunction?: BlendFunction;
}

const DIRECTIONS = 16;

const fragmentShader = /* glsl */ `
  uniform vec3 color;
  uniform float thickness;
  uniform float alpha;
  uniform vec2 texel;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float maxNeighborAlpha = 0.0;

    for (int i = 0; i < ${DIRECTIONS}; i++) {
      float angle = (float(i) / float(${DIRECTIONS})) * 6.28318530718;
      vec2 offset = vec2(cos(angle), sin(angle)) * thickness * texel;
      float a = texture2D(inputBuffer, uv + offset).a;
      maxNeighborAlpha = max(maxNeighborAlpha, a);
    }

    float outlineAlpha = maxNeighborAlpha * (1.0 - inputColor.a) * alpha;

    vec3 rgb = mix(color * outlineAlpha, inputColor.rgb, inputColor.a);
    float outAlpha = inputColor.a + outlineAlpha;
    outputColor = vec4(rgb, outAlpha);
  }
`;

/** Outline ring around the layer's alpha (2D layers only; needs a transparent background). */
export class OutlineEffect2D extends Effect {
  constructor({ color = '#000000', thickness = 2, alpha = 1, blendFunction = BlendFunction.NORMAL }: OutlineEffect2DOptions = {}) {
    super('OutlineEffect2D', fragmentShader, {
      blendFunction,
      attributes: EffectAttribute.NONE,
      uniforms: new Map<string, THREE.Uniform>([
        ['color', new THREE.Uniform(new THREE.Color(color))],
        ['thickness', new THREE.Uniform(thickness)],
        ['alpha', new THREE.Uniform(alpha)],
        ['texel', new THREE.Uniform(new THREE.Vector2(1, 1))],
      ]),
    });
  }

  get color(): string {
    return `#${(this.uniforms.get('color')!.value as THREE.Color).getHexString()}`;
  }

  set color(value: string) {
    (this.uniforms.get('color')!.value as THREE.Color).set(value);
  }

  get thickness(): number {
    return this.uniforms.get('thickness')!.value as number;
  }

  set thickness(value: number) {
    this.uniforms.get('thickness')!.value = value;
  }

  get alpha(): number {
    return this.uniforms.get('alpha')!.value as number;
  }

  set alpha(value: number) {
    this.uniforms.get('alpha')!.value = value;
  }

  override setSize(width: number, height: number): void {
    (this.uniforms.get('texel')!.value as THREE.Vector2).set(1 / width, 1 / height);
  }
}
