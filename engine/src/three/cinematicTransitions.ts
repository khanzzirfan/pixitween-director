import type { GlTransition } from './transition';

// Cut shaders written for this engine, beside the open gl-transitions collection: the ones a commercial reaches for that the collection
// does not have in a usable form. Same shape as a collection entry (a `transition(uv)` mixing getFromColor / getToColor by `progress`),
// so they are looked up by name the same way; a collection shader of the same name wins nothing, ours are checked first.

/** A fast pan that smears the picture along `direction` and splits the colour fringe while it moves; the old shot leaves one way as the new one arrives. */
const LENS_WHIP: GlTransition = {
  name: 'LensWhip',
  glsl: /* glsl */ `
uniform vec2 direction; // = vec2(1.0, 0.0)
uniform float strength; // = 0.5
vec3 whipTap(vec2 uv, vec2 dir, float ease, float spread, float fringe) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float t = float(i) / 11.0 - 0.5;
    vec2 o = dir * t * spread * fringe;
    vec2 a = clamp(uv - dir * ease * 0.5 + o, 0.0, 1.0);
    vec2 b = clamp(uv + dir * (1.0 - ease) * 0.5 + o, 0.0, 1.0);
    acc += mix(getFromColor(a).rgb, getToColor(b).rgb, smoothstep(0.38, 0.62, progress));
  }
  return acc / 12.0;
}
vec4 transition(vec2 uv) {
  vec2 dir = normalize(direction + vec2(1e-4));
  float ease = progress * progress * (3.0 - 2.0 * progress);
  float spread = sin(progress * 3.14159265) * strength * 0.4;
  float r = whipTap(uv, dir, ease, spread, 1.12).r;
  float g = whipTap(uv, dir, ease, spread, 1.0).g;
  float b = whipTap(uv, dir, ease, spread, 0.88).b;
  return vec4(r, g, b, 1.0);
}`,
  defaultParams: { direction: [1, 0], strength: 0.5 },
  paramsTypes: { direction: 'vec2', strength: 'float' },
};

/** A warm band of light sweeps across the frame, and the new shot is what it leaves behind: how a film burns between two scenes. */
const LIGHT_LEAK: GlTransition = {
  name: 'LightLeak',
  glsl: /* glsl */ `
uniform vec2 direction; // = vec2(1.0, 0.3)
uniform vec3 tint;      // = vec3(1.0, 0.62, 0.28)
uniform float strength; // = 0.8
vec4 transition(vec2 uv) {
  vec2 dir = normalize(direction + vec2(1e-4));
  float s = dot(uv - 0.5, dir) / (abs(dir.x) + abs(dir.y)) + 0.5;
  float front = progress * 1.7 - 0.35;
  float behind = smoothstep(front - 0.12, front + 0.12, s);
  vec3 picture = mix(getToColor(uv).rgb, getFromColor(uv).rgb, behind);
  float core = exp(-pow((s - front) / 0.2, 2.0));
  float halo = exp(-pow((s - front) / 0.55, 2.0));
  float flicker = 0.85 + 0.15 * sin(uv.y * 9.0 + progress * 11.0);
  vec3 glow = tint * (core * 1.0 + halo * 0.3) * flicker * strength;
  return vec4(picture + glow, 1.0);
}`,
  defaultParams: { direction: [1, 0.3], tint: [1, 0.62, 0.28], strength: 0.8 },
  paramsTypes: { direction: 'vec2', tint: 'vec3', strength: 'float' },
};

/** A push-in that rushes the frame outward from `center` as it blurs, with a hot flash at the swap: an impact cut. */
const ZOOM_PUNCH: GlTransition = {
  name: 'ZoomPunch',
  glsl: /* glsl */ `
uniform vec2 center;    // = vec2(0.5, 0.5)
uniform float strength; // = 0.6
vec4 transition(vec2 uv) {
  float peak = sin(progress * 3.14159265);
  float amount = strength * peak;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float s = float(i) / 11.0;
    vec2 q = clamp(center + (uv - center) * (1.0 - amount * s * 0.5), 0.0, 1.0);
    acc += mix(getFromColor(q).rgb, getToColor(q).rgb, smoothstep(0.42, 0.58, progress));
  }
  acc /= 12.0;
  float flash = pow(peak, 6.0) * 0.45 * strength;
  return vec4(acc + vec3(flash), 1.0);
}`,
  defaultParams: { center: [0.5, 0.5], strength: 0.6 },
  paramsTypes: { center: 'vec2', strength: 'float' },
};

export const CINEMATIC_TRANSITIONS: readonly GlTransition[] = [LENS_WHIP, LIGHT_LEAK, ZOOM_PUNCH];
