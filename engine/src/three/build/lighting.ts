// Ported from reacthub-pixitweenjs src/components/AepComposition/model3d/lighting.ts (MIT).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { type LightingEnvironment, type LightingPreset } from '../../schema/layer3d';

// `three` lighting presets. The tables are pure data (unit-tested); `createLightingRig` turns one
// into Three lights. Azimuth is degrees around Y: negative comes from the object's left (-X),
// positive from the right. Elevation is degrees above the horizon.

export interface LightingConfig {
  preset: LightingPreset;
  keyAzimuth: number;
  keyElevation: number;
  keyIntensity: number;
  keyColor: string;
  fillIntensity: number;
  rimIntensity: number;
  rimColor: string;
  ambientIntensity: number;
  environmentIntensity: number;
  environment: LightingEnvironment;
}

export const LIGHTING_PRESETS: Record<LightingPreset, LightingConfig> = {
  studio: {
    preset: 'studio',
    keyAzimuth: -35,
    keyElevation: 38,
    keyIntensity: 3.2,
    keyColor: '#fff7ec',
    fillIntensity: 1.1,
    rimIntensity: 1.6,
    rimColor: '#ffffff',
    ambientIntensity: 0.22,
    environmentIntensity: 0.75,
    environment: 'room',
  },
  window: {
    preset: 'window',
    keyAzimuth: -70,
    keyElevation: 55,
    keyIntensity: 2.4,
    keyColor: '#eef4ff',
    fillIntensity: 1.5,
    rimIntensity: 0.6,
    rimColor: '#ffffff',
    ambientIntensity: 0.35,
    environmentIntensity: 0.85,
    environment: 'room',
  },
  golden: {
    preset: 'golden',
    keyAzimuth: -58,
    keyElevation: 14,
    keyIntensity: 3.6,
    keyColor: '#ffd29a',
    fillIntensity: 0.8,
    rimIntensity: 1.2,
    rimColor: '#ffffff',
    ambientIntensity: 0.18,
    environmentIntensity: 0.55,
    environment: 'room',
  },
  night: {
    preset: 'night',
    keyAzimuth: -45,
    keyElevation: 20,
    keyIntensity: 1.2,
    keyColor: '#6f8cff',
    fillIntensity: 0.3,
    rimIntensity: 0.9,
    rimColor: '#ffffff',
    ambientIntensity: 0.05,
    environmentIntensity: 0.2,
    environment: 'none',
  },
  disco: {
    preset: 'disco',
    keyAzimuth: 40,
    keyElevation: 50,
    keyIntensity: 2.8,
    keyColor: '#ff2fd0',
    fillIntensity: 1.8,
    rimIntensity: 2.2,
    rimColor: '#ffffff',
    ambientIntensity: 0.15,
    environmentIntensity: 0.3,
    environment: 'none',
  },
  // The `none` preset has no rig lights: the scene keeps only the layer's extra lights.
  none: {
    preset: 'none',
    keyAzimuth: 0,
    keyElevation: 0,
    keyIntensity: 0,
    keyColor: '#ffffff',
    fillIntensity: 0,
    rimIntensity: 0,
    rimColor: '#ffffff',
    ambientIntensity: 0,
    environmentIntensity: 0,
    environment: 'none',
  },
};

export const DEFAULT_LIGHTING_PRESET: LightingPreset = 'studio';

export interface LightingOverrides {
  keyAzimuth?: number;
  keyElevation?: number;
  keyIntensity?: number;
  keyColor?: string;
  fillIntensity?: number;
  rimIntensity?: number;
  rimColor?: string;
}

export function resolveLightingConfig(
  preset: LightingPreset = DEFAULT_LIGHTING_PRESET,
  overrides: LightingOverrides = {},
  environment?: LightingEnvironment,
): LightingConfig {
  const base = LIGHTING_PRESETS[preset];
  return {
    ...base,
    keyAzimuth: overrides.keyAzimuth ?? base.keyAzimuth,
    keyElevation: overrides.keyElevation ?? base.keyElevation,
    keyIntensity: overrides.keyIntensity ?? base.keyIntensity,
    keyColor: overrides.keyColor ?? base.keyColor,
    fillIntensity: overrides.fillIntensity ?? base.fillIntensity,
    rimIntensity: overrides.rimIntensity ?? base.rimIntensity,
    rimColor: overrides.rimColor ?? base.rimColor,
    environment: environment ?? base.environment,
  };
}

/** Unit vector pointing from the light's target toward the light. */
export function directionFromAzimuthElevation(
  azimuthDeg: number,
  elevationDeg: number,
): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const cosEl = Math.cos(el);
  return [Math.sin(az) * cosEl, Math.sin(el), Math.cos(az) * cosEl];
}

export interface LightingRig {
  group: THREE.Group;
  ambient: THREE.AmbientLight;
  key: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
}

export const LIGHT_DISTANCE = 12;

export function createLightingRig(config: LightingConfig): LightingRig {
  const ambient = new THREE.AmbientLight(0xffffff, config.ambientIntensity);

  const key = new THREE.DirectionalLight(new THREE.Color(config.keyColor), config.keyIntensity);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0005;

  const fill = new THREE.DirectionalLight(0xffffff, config.fillIntensity);
  const rim = new THREE.DirectionalLight(new THREE.Color(config.rimColor), config.rimIntensity);

  const group = new THREE.Group();
  // `none` keeps the rig empty so the scene holds only the layer's extra lights.
  if (config.preset !== 'none') {
    group.add(ambient, key, key.target, fill, rim);
  }

  const rig: LightingRig = { group, ambient, key, fill, rim };
  applyLightingRig(rig, config);
  return rig;
}

export function applyLightingRig(rig: LightingRig, config: LightingConfig): void {
  rig.ambient.intensity = config.ambientIntensity;

  rig.key.intensity = config.keyIntensity;
  rig.fill.intensity = config.fillIntensity;
  rig.rim.intensity = config.rimIntensity;
  rig.key.color.set(config.keyColor);
  rig.rim.color.set(config.rimColor);
  setDirectionalPosition(rig.key, config.keyAzimuth, config.keyElevation);

  // Fill sits opposite the key, lower; rim is behind the product.
  setDirectionalPosition(rig.fill, config.keyAzimuth + 140, Math.max(5, config.keyElevation - 20));
  setDirectionalPosition(rig.rim, config.keyAzimuth + 180, Math.max(10, config.keyElevation + 5));
}

function setDirectionalPosition(light: THREE.DirectionalLight, azimuth: number, elevation: number): void {
  const [x, y, z] = directionFromAzimuthElevation(azimuth, elevation);
  light.position.set(x * LIGHT_DISTANCE, y * LIGHT_DISTANCE, z * LIGHT_DISTANCE);
  light.target.position.set(0, 0, 0);
  light.target.updateMatrixWorld();
}

export function disposeLightingRig(rig: LightingRig): void {
  rig.group.removeFromParent();
  rig.key.dispose();
  rig.fill.dispose();
  rig.rim.dispose();
  rig.ambient.dispose();
}

// One PMREM-filtered environment per Three renderer and kind, shared across every `three` layer so the env-map build cost is paid once.
const environments = new WeakMap<THREE.WebGLRenderer, Map<string, THREE.Texture>>();

/** A glowing flat shape at `at`, facing the origin, brighter than white (`power`) so a chrome surface picks it up as a hot reflection. */
function glow(shape: THREE.BufferGeometry, at: [number, number, number], color: number, power: number): THREE.Mesh {
  const m = new THREE.Mesh(shape, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide }));
  m.position.set(...at);
  m.lookAt(0, 0, 0);
  return m;
}

/** The scene a studio environment is drawn from: a dark room with its lights, or a graded sky. Lights are in the same place whatever the shot. */
export function buildStudio(kind: Exclude<LightingEnvironment, 'room' | 'none'>): THREE.Scene {
  const scene = new THREE.Scene();
  const dome = (colors: (y: number) => THREE.Color): void => {
    const g = new THREE.SphereGeometry(30, 32, 16);
    const pos = g.getAttribute('position');
    const c = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) colors(pos.getY(i) / 30).toArray(c, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  };
  if (kind === 'softbox') {
    dome(() => new THREE.Color(0x0d0d12));
    scene.add(glow(new THREE.PlaneGeometry(1.4, 9), [-6, 1, 1], 0xffffff, 7), glow(new THREE.PlaneGeometry(1.4, 9), [6, 1, -1], 0xfff1e0, 5), glow(new THREE.PlaneGeometry(9, 3), [0, 8, 0], 0xffffff, 3));
  } else if (kind === 'ring') {
    dome(() => new THREE.Color(0x101014));
    scene.add(glow(new THREE.RingGeometry(1.6, 2.1, 48), [0, 0.5, 8], 0xffffff, 9), glow(new THREE.PlaneGeometry(10, 10), [0, -8, 0], 0x303038, 1));
  } else {
    const low = new THREE.Color(0xff8a3d), high = new THREE.Color(0x1b2a55), ground = new THREE.Color(0x2a1a14);
    dome((y) => (y < 0 ? ground.clone().lerp(low, Math.max(0, 1 + y * 4)) : low.clone().lerp(high, Math.min(1, y * 1.6))));
    scene.add(glow(new THREE.CircleGeometry(1.8, 32), [14, 4, 6], 0xffd9a0, 14));
  }
  return scene;
}

export function getEnvironmentTexture(renderer: THREE.WebGLRenderer, kind: Exclude<LightingEnvironment, 'none'>): THREE.Texture {
  let byKind = environments.get(renderer);
  if (!byKind) environments.set(renderer, (byKind = new Map()));
  const cached = byKind.get(kind);
  if (cached) return cached;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = kind === 'room' ? new RoomEnvironment() : buildStudio(kind);
  const target = pmrem.fromScene(room, 0.04);
  room.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) material?.dispose();
  });
  pmrem.dispose();
  byKind.set(kind, target.texture);
  return target.texture;
}

export const getRoomEnvironmentTexture = (renderer: THREE.WebGLRenderer): THREE.Texture => getEnvironmentTexture(renderer, 'room');

export function applyEnvironment(scene: THREE.Scene, config: LightingConfig, renderer: THREE.WebGLRenderer): void {
  scene.environment = config.environment === 'none' ? null : getEnvironmentTexture(renderer, config.environment);
  scene.environmentIntensity = config.environmentIntensity;
}
