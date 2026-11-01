// Ported from node_modules/pixi-filters/lib/glow/glow.frag (MIT, read only; not imported).
// Samples the input alpha at 16 directions times 2 radii per direction up to `distance`, builds a
// glow mask from how much alpha surrounds a transparent pixel, and composites `color * mask * strength`
// behind the input so the input pixel (where alpha is 1) is kept as-is.
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import * as THREE from 'three';

export interface GlowEffectOptions {
  color?: string;
  strength?: number;
  distance?: number;
  blendFunction?: BlendFunction;
}

const DIRECTIONS = 16;
const RADII = 2;

const fragmentShader = /* glsl */ `
  uniform vec3 color;
  uniform float strength;
  uniform float distance;
  uniform vec2 texel;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float totalAlpha = 0.0;
    float maxAlpha = 0.0;

    for (int i = 0; i < ${DIRECTIONS}; i++) {
      float angle = (float(i) / float(${DIRECTIONS})) * 6.28318530718;
      vec2 direction = vec2(cos(angle), sin(angle)) * texel;

      for (int j = 1; j <= ${RADII}; j++) {
        float radius = (distance * float(j)) / float(${RADII});
        vec2 offset = direction * radius;
        float weight = 1.0 - (float(j) - 1.0) / float(${RADII});
        float a = texture2D(inputBuffer, uv + offset).a;
        totalAlpha += a * weight;
        maxAlpha += weight;
      }
    }

    float glowAlpha = clamp(totalAlpha / max(maxAlpha, 0.0001), 0.0, 1.0) * strength * (1.0 - inputColor.a);
    glowAlpha = clamp(glowAlpha, 0.0, 1.0);

    vec3 rgb = mix(color * glowAlpha, inputColor.rgb, inputColor.a);
    float alpha = max(inputColor.a, glowAlpha);
    outputColor = vec4(rgb, alpha);
  }
`;

/** Outer glow from the alpha around each pixel (2D layers only; needs a transparent background). */
export class GlowEffect extends Effect {
  constructor({ color = '#ffffff', strength = 2, distance = 10, blendFunction = BlendFunction.NORMAL }: GlowEffectOptions = {}) {
    super('GlowEffect', fragmentShader, {
      blendFunction,
      attributes: EffectAttribute.NONE,
      uniforms: new Map<string, THREE.Uniform>([
        ['color', new THREE.Uniform(new THREE.Color(color))],
        ['strength', new THREE.Uniform(strength)],
        ['distance', new THREE.Uniform(distance)],
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

  get strength(): number {
    return this.uniforms.get('strength')!.value as number;
  }

  set strength(value: number) {
    this.uniforms.get('strength')!.value = value;
  }

  get distance(): number {
    return this.uniforms.get('distance')!.value as number;
  }

  set distance(value: number) {
    this.uniforms.get('distance')!.value = value;
  }

  override setSize(width: number, height: number): void {
    (this.uniforms.get('texel')!.value as THREE.Vector2).set(1 / width, 1 / height);
  }
}
