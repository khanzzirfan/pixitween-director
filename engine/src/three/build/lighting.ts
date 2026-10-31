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
    ambientIntensity: 0.18,
    environmentIntensity: 0.55,
    environment: 'room',
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
  const rim = new THREE.DirectionalLight(0xffffff, config.rimIntensity);

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
  rig.key.color.set(config.keyColor);
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

// One PMREM-filtered room environment per Three renderer, shared across every `three` layer so the
// env-map build cost is paid once.
const roomEnvironments = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();

export function getRoomEnvironmentTexture(renderer: THREE.WebGLRenderer): THREE.Texture {
  const cached = roomEnvironments.get(renderer);
  if (cached) return cached;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const target = pmrem.fromScene(room, 0.04);
  room.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) material?.dispose();
  });
  pmrem.dispose();
  roomEnvironments.set(renderer, target.texture);
  return target.texture;
}

export function applyEnvironment(scene: THREE.Scene, config: LightingConfig, renderer: THREE.WebGLRenderer): void {
  scene.environment = config.environment === 'room' ? getRoomEnvironmentTexture(renderer) : null;
  scene.environmentIntensity = config.environmentIntensity;
}