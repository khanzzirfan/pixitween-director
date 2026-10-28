import type { AssetRef } from '@shared/composition';
import type { AssetStore, FilmStore, Ledger, MetaClients } from '@shared/ports';
import type { EmitInput, ToolCtx } from '@shared/tools';
import type { createEventBus } from '../events/bus';
import type { FilmAdmission } from '@shared/ports';

export type EventBus = ReturnType<typeof createEventBus>;
export type ToolCtxDeps = { films: FilmStore; assets: AssetStore; meta: MetaClients; ledger: Ledger; bus: EventBus };
export type AppDeps = ToolCtxDeps & {
  assets: AssetStore & { absoluteUrl(id: string): string; get(id: string): Promise<AssetRef> };
  makeToolCtx(filmId: string): ToolCtx;
  /** Film admission (D-16). Optional and mutable: handlers read it at request time and never cache it. */
  admission?: FilmAdmission;
};

/** Stamp `filmId` and `at` onto an event the caller left unstamped and forward it to the bus; failures are logged, never thrown. */
export function emitStamped(bus: EventBus, filmId: string, e: EmitInput): void {
  const event = { filmId, at: new Date().toISOString(), ...e } as Parameters<EventBus['emit']>[1];
  bus.emit(filmId, event).catch((err: unknown) => console.error(`emit failed for ${filmId}:`, err));
}

/** Builds the ToolCtx for one film. `emit` stamps `filmId` and `at` when the caller omits them. */
export function makeToolCtx(deps: ToolCtxDeps, filmId: string): ToolCtx {
  return {
    filmId,
    films: deps.films,
    assets: deps.assets,
    meta: deps.meta,
    ledger: deps.ledger,
    emit: (e: EmitInput) => emitStamped(deps.bus, filmId, e),
  };
}
