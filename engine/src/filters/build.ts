import type { Filter } from 'pixi.js';
import { hashString } from '../core/seed';
import type { TargetRef } from '../core/paths';
import type { Filter2DType } from '../schema';
import { FILTERS, type FilterDef, type ParamValue } from './registry';

/** One layer's (or the doc's) filter spec, before the registry merges in its defaults. */
export interface Filter2D {
  id: string;
  type: Filter2DType;
  enabled?: boolean;
  params?: Record<string, ParamValue>;
}

/** A built filter with the registry entry that made it and the proxy the timeline tweens. */
export interface BuiltFilter {
  filter: Filter;
  def: FilterDef;
  /** One accessor per tweenable param, so a tween writes through `def.tweenable[k].set`. */
  proxy: Record<string, number | string>;
  /** `hashString(id)`, the salt `tick` passes to `seedFor`. */
  salt: number;
}

export interface BuiltFilters {
  /** The enabled filters, in spec order. */
  filters: Filter[];
  byId: Map<string, BuiltFilter>;
  /** A `filter:<id>` target for `prop`, or null when the id or the param is unknown. */
  resolveTarget(id: string, prop: string): TargetRef | null;
  /** Calls each time-driven filter's `tick` with its salt so a frame always looks the same. */
  tick(timeSec: number, frame: number): void;
  destroy(): void;
  /** Unknown params (and other spec problems), ignored rather than thrown. */
  errors: string[];
}

/** A proxy with an accessor per tweenable param; the setter calls the registry's `set`. */
function makeProxy(filter: Filter, def: FilterDef): Record<string, number | string> {
  const proxy: Record<string, number | string> = {};
  for (const [prop, spec] of Object.entries(def.tweenable)) {
    Object.defineProperty(proxy, prop, {
      get: () => spec.get(filter),
      set: (value: number | string) => spec.set(filter, value),
      enumerable: true,
      configurable: true,
    });
  }
  return proxy;
}

/**
 * Turns a layer's filter specs into live Pixi filters plus `filter:<id>` tween targets
 * (engine/docs/05-filters-postfx.md). Defaults are merged under each spec's params, disabled specs
 * are skipped, and an unknown param is reported in `errors` but does not stop the filter being made.
 */
export function buildFilters(specs: Filter2D[]): BuiltFilters {
  const filters: Filter[] = [];
  const byId = new Map<string, BuiltFilter>();
  const errors: string[] = [];

  for (const spec of specs) {
    if (spec.enabled === false) continue;

    const def: FilterDef = FILTERS[spec.type];
    const params = spec.params ?? {};

    for (const key of Object.keys(params)) {
      if (!(key in def.defaults)) {
        errors.push(`filter "${spec.id}": unknown param "${key}"`);
      }
    }

    const filter = def.create({ ...def.defaults, ...params });
    filters.push(filter);
    byId.set(spec.id, { filter, def, proxy: makeProxy(filter, def), salt: hashString(spec.id) });
  }

  return {
    filters,
    byId,
    errors,

    resolveTarget(id, prop) {
      const entry = byId.get(id);
      if (!entry) return null;

      const spec = entry.def.tweenable[prop];
      if (!spec) return null;

      const ref: TargetRef = { obj: entry.proxy, key: prop, kind: spec.kind };
      if (spec.kind === 'color') {
        ref.getColor = () => spec.get(entry.filter) as string;
        ref.setColor = (hex) => spec.set(entry.filter, hex);
      }
      return ref;
    },

    tick(timeSec, frame) {
      for (const entry of byId.values()) {
        entry.def.tick?.(entry.filter, timeSec, frame, entry.salt);
      }
    },

    destroy() {
      for (const entry of byId.values()) {
        entry.filter.destroy();
      }
    },
  };
}
