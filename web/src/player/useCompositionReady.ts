// Owned by S13b. Tells capture and export when every 3D layer has drawn its first frame.
// The engine's `onRenderReady` fires once every model3d layer has drawn (at once when there are none) and `onLayerError` says a layer failed (engine 0.3.0-alpha.4 and newer).
import enginePkg from 'reacthub-pixitweenjs/package.json';

export interface Readiness {
  /** Resolves true when the picture is complete, false when a 3D layer failed or `timeoutSec` passed first. */
  whenReady(timeoutSec: number): Promise<boolean>;
  markReady(): void;
  markError(layerId: string, error: unknown): void;
  /** Layers the engine reported as failed. */
  readonly errors: ReadonlyArray<{ layerId: string; message: string }>;
}

/** Whether a composition (the root or any scene) holds a model3d layer. */
export function hasModel3D(comp: { layers?: Array<{ kind?: string }>; precomps?: Record<string, { layers?: Array<{ kind?: string }> }> } | null | undefined): boolean {
  if (!comp) return false;
  if (comp.layers?.some((l) => l.kind === 'model3d')) return true;
  return Object.values(comp.precomps ?? {}).some((p) => p.layers?.some((l) => l.kind === 'model3d'));
}

/** The first engine version whose AepComposition reports `onRenderReady` and `onLayerError`. */
const MIN_RENDER_READY = '0.3.0-alpha.4';

function parse(v: string): { nums: number[]; pre: Array<string | number> | null } {
  const [core = '', pre] = v.split('-');
  return { nums: core.split('.').map(Number), pre: pre ? pre.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : null };
}
/** True when `version` is at least `min` (a release is above any pre-release of the same numbers). */
export function versionAtLeast(version: string, min: string): boolean {
  const a = parse(version);
  const b = parse(min);
  for (let i = 0; i < 3; i++) if ((a.nums[i] ?? 0) !== (b.nums[i] ?? 0)) return (a.nums[i] ?? 0) > (b.nums[i] ?? 0);
  if (!a.pre) return true;
  if (!b.pre) return false;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return false;
    if (y === undefined) return true;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x > y;
    return typeof x === 'number' ? false : typeof y === 'number' ? true : x > y;
  }
  return true;
}

export const engineVersion: string = (enginePkg as { version?: string }).version ?? '';
/** Feature check: an engine older than alpha.4 never calls onRenderReady, so waiting for it would only time out. */
export const supportsRenderReady = (version: string = engineVersion): boolean => !version || versionAtLeast(version, MIN_RENDER_READY);

/** `needed` is false for a film with no 3D layer, or an engine that cannot say: then whenReady is true at once. */
export function createReadiness(o: { needed: boolean }): Readiness {
  let ready = !o.needed;
  const errors: Array<{ layerId: string; message: string }> = [];
  const waiting = new Set<() => void>();
  const settle = () => waiting.forEach((w) => w());
  return {
    errors,
    markReady() {
      ready = true;
      settle();
    },
    markError(layerId, error) {
      errors.push({ layerId, message: error instanceof Error ? error.message : String(error) });
      settle();
    },
    whenReady(timeoutSec) {
      if (errors.length) return Promise.resolve(false);
      if (ready) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(done, Math.max(0, timeoutSec) * 1000, false);
        function done(v: boolean) {
          clearTimeout(timer);
          waiting.delete(check);
          resolve(v);
        }
        const check = () => {
          if (errors.length) done(false);
          else if (ready) done(true);
        };
        waiting.add(check);
      });
    },
  };
}
