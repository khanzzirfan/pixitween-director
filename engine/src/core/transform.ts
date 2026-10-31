import type { Container } from 'pixi.js';
import type { Layer } from '../schema';
import type { TargetRef } from './paths';

const BLEND_MODES: Record<Layer['blendMode'], Container['blendMode']> = {
  normal: 'normal',
  add: 'add',
  multiply: 'multiply',
  screen: 'screen',
};

const DEG_TO_RAD = Math.PI / 180;

const scaleProxies = new WeakMap<Container, { scale: number }>();

function scaleProxy(display: Container): { scale: number } {
  let proxy = scaleProxies.get(display);
  if (!proxy) {
    proxy = {
      get scale(): number {
        return display.scale.x;
      },
      set scale(value: number) {
        display.scale.set(value, value);
      },
    };
    scaleProxies.set(display, proxy);
  }
  return proxy;
}

export function applyBaseTransform(display: Container, layer: Layer, size: { width: number; height: number }): void {
  display.x = layer.x;
  display.y = layer.y;
  display.rotation = layer.rotation * DEG_TO_RAD;

  if (typeof layer.scale === 'number') {
    display.scale.set(layer.scale);
  } else {
    display.scale.set(layer.scale[0], layer.scale[1]);
  }

  const [ax, ay] = layer.anchor;
  display.pivot.set(ax * size.width, ay * size.height);
  display.alpha = layer.alpha;
  display.blendMode = BLEND_MODES[layer.blendMode];
}

export function resolveBaseTarget(display: Container, prop: string): TargetRef | null {
  switch (prop) {
    case 'x':
    case 'y':
    case 'alpha':
      return { obj: display, key: prop, kind: 'number' };
    case 'rotation':
      return { obj: display, key: 'rotation', kind: 'deg' };
    case 'skewX':
      return { obj: display.skew, key: 'x', kind: 'deg' };
    case 'skewY':
      return { obj: display.skew, key: 'y', kind: 'deg' };
    case 'scaleX':
      return { obj: display.scale, key: 'x', kind: 'number' };
    case 'scaleY':
      return { obj: display.scale, key: 'y', kind: 'number' };
    case 'scale':
      return { obj: scaleProxy(display), key: 'scale', kind: 'number' };
    default:
      return null;
  }
}
