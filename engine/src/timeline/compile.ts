import type { TargetRef } from '../core/paths';

export type Resolve = (target: string | undefined, prop: string) => TargetRef | null;

export interface CompileResult {
  added: number;
  errors: string[];
}

export interface Tween {
  target?: string;
  at: number;
  duration: number;
  ease?: string;
  from?: Record<string, number | string>;
  to: Record<string, number | string>;
  repeat?: number;
  yoyo?: boolean;
}

const DEG_TO_RAD = Math.PI / 180;

interface PropGroup {
  obj: object;
  from: Record<string, number>;
  to: Record<string, number>;
}

interface ColorTween {
  ref: TargetRef;
  from: string;
  to: string;
}

function numeric(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

/** Degrees in the schema become radians; Pixi and Three both store radians. Colours become proxies. */
function convert(value: number | string, kind: TargetRef['kind']): number {
  const n = numeric(value);
  return kind === 'deg' ? n * DEG_TO_RAD : n;
}

/** The value a missing `from` key starts from: the object's value at compile time. */
function readCompileTimeValue(obj: object, key: string): number {
  const value = (obj as Record<string, number | undefined>)[key];
  return typeof value === 'number' ? value : 0;
}

/** Normalises a rendered colour (`#rgb`, `#rrggbb` or `rgba(r,g,b,a)`) to `#rrggbb`. */
function toHex(value: string): string {
  const trimmed = value.trim();
  if (trimmed.charAt(0) === '#') {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toLowerCase();
    }
    if (hex.length === 6) return `#${hex}`.toLowerCase();
    return trimmed;
  }
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(trimmed);
  if (!match) return trimmed;
  const channel = (raw: string): string => {
    const clamped = Math.min(255, Math.max(0, Math.round(Number(raw))));
    return clamped.toString(16).padStart(2, '0');
  };
  return `#${channel(match[1])}${channel(match[2])}${channel(match[3])}`;
}

/**
 * A one-key proxy whose `v` setter normalises every rendered colour and hands it to `setColor`.
 * GSAP writes plain-object properties directly on each render, including a `suppressEvents` seek,
 * so a property setter is the only write-back path that works under `MotionClock.seek` (its
 * `onUpdate` callbacks are suppressed; see engine/docs/02-timeline.md and the codebase patterns).
 */
function makeColorProxy(from: string, setColor?: (hex: string) => void): Record<string, string> {
  const state = { v: from };
  const proxy: Record<string, string> = {};
  Object.defineProperty(proxy, 'v', {
    get: () => state.v,
    set: (value: string) => {
      state.v = value;
      if (typeof value === 'string') setColor?.(toHex(value));
    },
    enumerable: true,
    configurable: true,
  });
  return proxy;
}

/**
 * Compiles a layer's tweens onto the master timeline as `fromTo` calls with `immediateRender: false`.
 * Every tween is placed at `layerStart + at`, so any seek order gives the same values
 * (engine/docs/02-timeline.md, "Tween compiler" and "Determinism rules"). Colour keys are routed
 * through a proxy so `setColor` runs on every render; `repeat`/`yoyo` pass straight to GSAP.
 */
export function compileTweens(
  tl: gsap.core.Timeline,
  tweens: Tween[],
  opts: { layerStart: number; resolve: Resolve; layerId: string },
): CompileResult {
  const errors: string[] = [];
  let added = 0;

  tweens.forEach((tween, index) => {
    const props = new Set<string>(Object.keys(tween.to));
    if (tween.from) {
      for (const key of Object.keys(tween.from)) props.add(key);
    }

    const groups = new Map<object, PropGroup>();
    const colors: ColorTween[] = [];
    let problem: string | null = null;

    for (const prop of props) {
      const ref = opts.resolve(tween.target, prop);
      if (!ref) {
        problem = `layers.${opts.layerId}.tweens[${index}]: unknown property "${prop}" on ${tween.target ?? 'layer'}`;
        break;
      }

      const hasTo = Object.prototype.hasOwnProperty.call(tween.to, prop);
      const hasFrom = tween.from !== undefined && Object.prototype.hasOwnProperty.call(tween.from, prop);

      if (ref.kind === 'color') {
        if (!hasTo) continue;
        const from = hasFrom
          ? String((tween.from as Record<string, number | string>)[prop])
          : ref.getColor?.() ?? '#000000';
        colors.push({ ref, from, to: String(tween.to[prop]) });
        continue;
      }

      let group = groups.get(ref.obj);
      if (!group) {
        group = { obj: ref.obj, from: {}, to: {} };
        groups.set(ref.obj, group);
      }

      if (hasTo) {
        group.to[ref.key] = convert(tween.to[prop], ref.kind);
      }
      if (hasFrom) {
        group.from[ref.key] = convert((tween.from as Record<string, number | string>)[prop], ref.kind);
      } else if (hasTo) {
        group.from[ref.key] = readCompileTimeValue(ref.obj, ref.key);
      }
    }

    if (problem !== null) {
      errors.push(problem);
      return;
    }

    const at = opts.layerStart + tween.at;
    for (const group of groups.values()) {
      if (tween.duration === 0) {
        tl.set(group.obj, group.to, at);
      } else {
        tl.fromTo(
          group.obj,
          group.from,
          {
            ...group.to,
            duration: tween.duration,
            ease: tween.ease ?? 'none',
            repeat: tween.repeat ?? 0,
            yoyo: tween.yoyo ?? false,
            immediateRender: false,
          },
          at,
        );
      }
      added += 1;
    }

    for (const color of colors) {
      const proxy = makeColorProxy(color.from, color.ref.setColor);
      if (tween.duration === 0) {
        tl.set(proxy, { v: color.to }, at);
      } else {
        tl.fromTo(
          proxy,
          { v: color.from },
          {
            v: color.to,
            duration: tween.duration,
            ease: tween.ease ?? 'none',
            repeat: tween.repeat ?? 0,
            yoyo: tween.yoyo ?? false,
            immediateRender: false,
          },
          at,
        );
      }
      added += 1;
    }
  });

  return { added, errors };
}

/** Records every tween's start values, then parks the playhead on `timeSec`. */
export function primeTimeline(tl: gsap.core.Timeline, timeSec = 0): void {
  tl.progress(1, true).progress(0, true);
  tl.seek(timeSec, false);
}
