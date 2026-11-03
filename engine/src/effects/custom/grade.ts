// Two looks of a colour grade that the library's effects do not have: split toning (a tint in the shadows and another in the highlights)
// and an anamorphic lens streak (a bright light drawing a horizontal blue line across the frame). Both are one-pass effects over the picture.
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import * as THREE from 'three';

const colorUniform = (effect: Effect, name: string): THREE.Color => effect.uniforms.get(name)!.value as THREE.Color;
const hex = (c: THREE.Color): string => `#${c.getHexString()}`;

const SPLIT_TONE = /* glsl */ `
  uniform vec3 shadowColor;
  uniform vec3 highlightColor;
  uniform float amount;
  uniform float balance;

  // the direction a colour pushes the picture in, without changing how bright the picture is
  vec3 pushOf(vec3 c) {
    return c - vec3(dot(c, vec3(0.2126, 0.7152, 0.0722)));
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float luma = dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    float mid = clamp(0.5 + balance * 0.3, 0.1, 0.9);
    float shadows = 1.0 - smoothstep(0.0, mid, luma);
    float highlights = smoothstep(mid, 1.0, luma);
    vec3 rgb = inputColor.rgb + (pushOf(shadowColor) * shadows + pushOf(highlightColor) * highlights) * amount * 1.5;
    outputColor = vec4(max(rgb, 0.0), inputColor.a);
  }
`;

export interface SplitToneOptions {
  shadows?: string;
  highlights?: string;
  amount?: number;
  balance?: number;
}

/** Split toning: `shadows` tints the dark part of the picture and `highlights` the bright part, `amount` 0 to 1, `balance` -1 to 1 moves the line between them. */
export class SplitToneEffect extends Effect {
  constructor({ shadows = '#1d4a6b', highlights = '#ffb877', amount = 0.5, balance = 0 }: SplitToneOptions = {}) {
    super('SplitToneEffect', SPLIT_TONE, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['shadowColor', new THREE.Uniform(new THREE.Color(shadows))],
        ['highlightColor', new THREE.Uniform(new THREE.Color(highlights))],
        ['amount', new THREE.Uniform(amount)],
        ['balance', new THREE.Uniform(balance)],
      ]),
    });
  }

  get shadows(): string {
    return hex(colorUniform(this, 'shadowColor'));
  }

  set shadows(v: string) {
    colorUniform(this, 'shadowColor').set(v);
  }

  get highlights(): string {
    return hex(colorUniform(this, 'highlightColor'));
  }

  set highlights(v: string) {
    colorUniform(this, 'highlightColor').set(v);
  }

  get amount(): number {
    return this.uniforms.get('amount')!.value as number;
  }

  set amount(v: number) {
    this.uniforms.get('amount')!.value = v;
  }

  get balance(): number {
    return this.uniforms.get('balance')!.value as number;
  }

  set balance(v: number) {
    this.uniforms.get('balance')!.value = v;
  }
}

const TAPS = 24;

const LENS_STREAK = /* glsl */ `
  uniform vec3 streakColor;
  uniform float strength;
  uniform float threshold;
  uniform float reach;
  uniform vec2 texel;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    // the bright part of the picture, gathered along the row both ways and fading with distance
    vec3 streak = vec3(0.0);
    float total = 0.0;
    for (int i = 1; i <= ${TAPS}; i++) {
      float f = float(i) / float(${TAPS});
      float weight = exp(-f * 3.0);
      vec2 along = vec2(f * reach, 0.0);
      vec3 a = texture2D(inputBuffer, uv + along).rgb;
      vec3 b = texture2D(inputBuffer, uv - along).rgb;
      streak += (max(a - vec3(threshold), 0.0) + max(b - vec3(threshold), 0.0)) * weight;
      total += 2.0 * weight;
    }
    vec3 lit = streak / total * strength * 6.0 * streakColor;
    outputColor = vec4(inputColor.rgb + lit, inputColor.a);
  }
`;

export interface LensStreakOptions {
  color?: string;
  strength?: number;
  threshold?: number;
  /** How far the streak reaches, as a share of the frame's width (0.05 short, 0.5 across half the frame). */
  reach?: number;
}

/** An anamorphic lens streak: every light brighter than `threshold` draws a horizontal line of `color` through the frame. */
export class LensStreakEffect extends Effect {
  constructor({ color = '#7fb2ff', strength = 0.5, threshold = 0.8, reach = 0.3 }: LensStreakOptions = {}) {
    super('LensStreakEffect', LENS_STREAK, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.NONE,
      uniforms: new Map<string, THREE.Uniform>([
        ['streakColor', new THREE.Uniform(new THREE.Color(color))],
        ['strength', new THREE.Uniform(strength)],
        ['threshold', new THREE.Uniform(threshold)],
        ['reach', new THREE.Uniform(reach)],
        ['texel', new THREE.Uniform(new THREE.Vector2(1, 1))],
      ]),
    });
  }

  get color(): string {
    return hex(colorUniform(this, 'streakColor'));
  }

  set color(v: string) {
    colorUniform(this, 'streakColor').set(v);
  }

  get strength(): number {
    return this.uniforms.get('strength')!.value as number;
  }

  set strength(v: number) {
    this.uniforms.get('strength')!.value = v;
  }

  get threshold(): number {
    return this.uniforms.get('threshold')!.value as number;
  }

  set threshold(v: number) {
    this.uniforms.get('threshold')!.value = v;
  }

  get reach(): number {
    return this.uniforms.get('reach')!.value as number;
  }

  set reach(v: number) {
    this.uniforms.get('reach')!.value = v;
  }

  override setSize(width: number, height: number): void {
    (this.uniforms.get('texel')!.value as THREE.Vector2).set(1 / width, 1 / height);
  }
}
