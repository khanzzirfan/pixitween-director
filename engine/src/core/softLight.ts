import * as THREE from 'three';

// Soft light (engine/docs/03-stage-2d.md, "Blend modes"): the W3C soft-light formula over the frame
// behind the layer. The frame is not in the material's hands, so the layer reads it from a texture
// the runtime hands it (engine/src/runtime/assemble.ts, "the frame behind a soft-light layer").

/**
 * The W3C soft-light blend of one channel (`https://www.w3.org/TR/compositing/#blending-soft-light`):
 * `base` is the frame behind the layer, `blend` the layer's colour.
 */
export function softLightBlend(base: number, blend: number): number {
  if (blend <= 0.5) return base - (1 - 2 * blend) * base * (1 - base);
  const d = base <= 0.25 ? ((16 * base - 12) * base + 4) * base : Math.sqrt(base);
  return base + (2 * blend - 1) * (d - 0.5);
}

/**
 * The colour a soft-light layer leaves behind, the way the engine blends: the layer's colour is
 * scaled by its opacity first (the engine blends in premultiplied alpha, like its other blend
 * modes), the W3C formula runs on that, and the result is mixed back over the frame by the opacity.
 *
 * A white layer at half opacity is therefore a half-grey blend, and soft light at 0.5 is the
 * identity: the frame behind it stays where it was.
 */
export function softLightComposite(backdrop: number, source: number, alpha: number): number {
  const blended = softLightBlend(backdrop, source * alpha);
  return backdrop + (blended - backdrop) * alpha;
}

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vStagePos;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vStagePos = world.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// The same formula as `softLightBlend`, per channel, with the premultiplied source of
// `softLightComposite`: the layer's colour scaled by its opacity goes into the formula, and the
// result is mixed back over the frame by the opacity.
const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uBackdrop;
  uniform sampler2D uMap;
  uniform float uHasMap;
  uniform float uPremultiplied;
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform vec2 uStage;

  varying vec2 vStagePos;
  varying vec2 vUv;

  float softLightChannel(float base, float blend) {
    if (blend <= 0.5) return base - (1.0 - 2.0 * blend) * base * (1.0 - base);
    float d = base <= 0.25 ? ((16.0 * base - 12.0) * base + 4.0) * base : sqrt(base);
    return base + (2.0 * blend - 1.0) * (d - 0.5);
  }

  vec3 softLight(vec3 base, vec3 blend) {
    return vec3(
      softLightChannel(base.r, blend.r),
      softLightChannel(base.g, blend.g),
      softLightChannel(base.b, blend.b)
    );
  }

  void main() {
    // The frame behind the layer, in stage space: the backdrop holds the whole doc, and the
    // stage camera looks at (0, 0)..(width, -height).
    vec2 backdropUv = vec2(vStagePos.x / uStage.x, (vStagePos.y + uStage.y) / uStage.y);
    vec4 backdrop = texture2D(uBackdrop, backdropUv);
    vec3 backdropColor = backdrop.a > 0.0 ? backdrop.rgb / backdrop.a : vec3(0.0);

    vec4 source = uHasMap > 0.5 ? texture2D(uMap, vUv) : vec4(1.0);
    // A three layer's render target holds premultiplied colour, so its colour comes back out.
    vec3 sourceColor = uPremultiplied > 0.5 && source.a > 0.0 ? source.rgb / source.a : source.rgb;
    vec3 src = sourceColor * uColor;
    float alpha = source.a * uAlpha;

    vec3 blended = softLight(backdropColor, src * alpha);
    vec3 outColor = mix(backdropColor, blended, alpha);
    float outAlpha = mix(backdrop.a, 1.0, alpha);
    gl_FragColor = vec4(outColor * outAlpha, outAlpha);

    // The engine draws in linear and the canvas takes sRGB, like every other material does.
    #include <colorspace_fragment>
  }
`;

/** A 1x1 transparent black texture, so the material has something to sample before the first frame. */
function placeholderBackdrop(): THREE.Texture {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  texture.needsUpdate = true;
  return texture;
}

export interface SoftLightOptions {
  /** The layer's own colour: a shape's fill, an image's tint, white for a text or a three layer. */
  color?: string;
  /** The layer's own texture, when it draws one (an image, a text, a three layer's render target). */
  map?: THREE.Texture | null;
  /** true when the texture holds premultiplied colour (a three layer's render target). */
  premultiplied?: boolean;
}

export interface SoftLightMaterial {
  readonly material: THREE.ShaderMaterial;
  /** The source colour; a colour tween writes into it and the shader reads it every frame. */
  readonly color: THREE.Color;
  /** The layer's effective opacity (its own alpha times its ancestors'). */
  setAlpha(alpha: number): void;
  /** The frame behind the layer, and the size of the stage it was drawn at. */
  setBackdrop(texture: THREE.Texture, stage: { width: number; height: number }): void;
  dispose(): void;
}

/**
 * A material that blends its layer into the frame behind it with the W3C soft-light formula.
 *
 * The layer's colour is scaled by the layer's opacity before it goes into the formula (the engine
 * blends in premultiplied alpha), so a white layer at half opacity is a half-grey blend — and soft
 * light at 0.5 is the identity, which leaves the frame where it was.
 */
export function createSoftLightMaterial(opts: SoftLightOptions = {}): SoftLightMaterial {
  const color = new THREE.Color(opts.color ?? '#ffffff');
  const placeholder = placeholderBackdrop();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uBackdrop: { value: placeholder },
      uMap: { value: opts.map ?? null },
      uHasMap: { value: opts.map ? 1 : 0 },
      uPremultiplied: { value: opts.premultiplied ? 1 : 0 },
      uColor: { value: color },
      uAlpha: { value: 1 },
      uStage: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    // The shader writes the blended colour itself, so it replaces the frame instead of blending
    // with it a second time.
    blending: THREE.NoBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

  return {
    material,
    color,
    setAlpha(alpha: number) {
      material.uniforms.uAlpha.value = alpha;
    },
    setBackdrop(texture: THREE.Texture, stage: { width: number; height: number }) {
      material.uniforms.uBackdrop.value = texture;
      material.uniforms.uStage.value.set(stage.width, stage.height);
    },
    dispose() {
      // The placeholder is the material's own; the frame behind the layer belongs to the runtime.
      if (material.uniforms.uBackdrop.value === placeholder) placeholder.dispose();
      material.dispose();
    },
  };
}
