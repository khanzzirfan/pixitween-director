// Ported from node_modules/pixi-filters/lib/drop-shadow/drop-shadow.frag (MIT, read only; not imported).
// Offsets the input alpha by (distance, angle) in doc pixel space (y down), blurs it with a small box
// kernel scaled by `blur`, and composites `color * alpha * shadowAlpha` behind the input.
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import * as THREE from 'three';

export interface DropShadowEffectOptions {
  color?: string;
  alpha?: number;
  distance?: number;
  angle?: number;
  blur?: number;
  blendFunction?: BlendFunction;
}

const TAPS = 8;

const fragmentShader = /* glsl */ `
  uniform vec3 color;
  uniform float alpha;
  uniform vec2 offset;
  uniform float blur;
  uniform vec2 texel;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 shadowUv = uv - offset * texel;

    float shadowAlpha = 0.0;
    float total = 0.0;
    for (int i = 0; i < ${TAPS}; i++) {
      float a = (float(i) / float(${TAPS} - 1)) * 2.0 - 1.0;
      vec2 o = vec2(a, a) * blur * texel;
      shadowAlpha += texture2D(inputBuffer, shadowUv + o).a;
      total += 1.0;
    }
    shadowAlpha = clamp(shadowAlpha / max(total, 0.0001), 0.0, 1.0) * alpha;

    vec3 rgb = mix(color * shadowAlpha, inputColor.rgb, inputColor.a);
    float outAlpha = inputColor.a + shadowAlpha * (1.0 - inputColor.a);
    outputColor = vec4(rgb, outAlpha);
  }
`;

function computeOffset(distance: number, angle: number): THREE.Vector2 {
  const rad = (angle * Math.PI) / 180;
  // y down in the doc becomes y up in UV, so the y component is negated.
  return new THREE.Vector2(distance * Math.cos(rad), -distance * Math.sin(rad));
}

/** Drop shadow behind the layer's alpha (2D layers only; needs a transparent background). */
export class DropShadowEffect extends Effect {
  private _distance: number;
  private _angle: number;

  constructor({
    color = '#000000',
    alpha = 0.5,
    distance = 6,
    angle = 45,
    blur = 4,
    blendFunction = BlendFunction.NORMAL,
  }: DropShadowEffectOptions = {}) {
    super('DropShadowEffect', fragmentShader, {
      blendFunction,
      attributes: EffectAttribute.NONE,
      uniforms: new Map<string, THREE.Uniform>([
        ['color', new THREE.Uniform(new THREE.Color(color))],
        ['alpha', new THREE.Uniform(alpha)],
        ['offset', new THREE.Uniform(computeOffset(distance, angle))],
        ['blur', new THREE.Uniform(blur)],
        ['texel', new THREE.Uniform(new THREE.Vector2(1, 1))],
      ]),
    });
    this._distance = distance;
    this._angle = angle;
  }

  get color(): string {
    return `#${(this.uniforms.get('color')!.value as THREE.Color).getHexString()}`;
  }

  set color(value: string) {
    (this.uniforms.get('color')!.value as THREE.Color).set(value);
  }

  get alpha(): number {
    return this.uniforms.get('alpha')!.value as number;
  }

  set alpha(value: number) {
    this.uniforms.get('alpha')!.value = value;
  }

  get distance(): number {
    return this._distance;
  }

  set distance(value: number) {
    this._distance = value;
    (this.uniforms.get('offset')!.value as THREE.Vector2).copy(computeOffset(this._distance, this._angle));
  }

  get angle(): number {
    return this._angle;
  }

  set angle(value: number) {
    this._angle = value;
    (this.uniforms.get('offset')!.value as THREE.Vector2).copy(computeOffset(this._distance, this._angle));
  }

  get blur(): number {
    return this.uniforms.get('blur')!.value as number;
  }

  set blur(value: number) {
    this.uniforms.get('blur')!.value = value;
  }

  override setSize(width: number, height: number): void {
    (this.uniforms.get('texel')!.value as THREE.Vector2).set(1 / width, 1 / height);
  }
}
