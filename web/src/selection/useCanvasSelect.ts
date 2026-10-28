import { useEffect } from 'react';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import type { PlayerHandle } from '../player/Player';
import { layerIdFromPixiTarget, resolveLayerId, selectionFromLayerId, type PixiNodeLike } from './pixiTarget';
import type { EditSelection } from './useSelection';
export function useCanvasSelect(o: {
  player?: PlayerHandle | null;
  comp?: AepCompositionJson | null;
  onPick(s: EditSelection | undefined): void;
}): void {
  useEffect(() => {
    if (!o.player) return;
    let cancelled = false,
      raf = 0;
    let stage: any;
    let oldMode: any, oldArea: any;
    const attach = (attempt: number) => {
      if (cancelled) return;
      const app = o.player?.getApp();
      if (!app) {
        if (attempt < 60) raf = requestAnimationFrame(() => attach(attempt + 1));
        return;
      }
      stage = app.stage;
      oldMode = stage.eventMode;
      oldArea = stage.hitArea;
      stage.eventMode = 'static';
      stage.hitArea = app.screen;
      const handler = (event: any) => {
        const comp = o.comp;
        if (!comp) {
          o.onPick(undefined);
          return;
        }
        const id = resolveLayerId(event.target as PixiNodeLike, event.global, {
          isSelectable: (layerId) => {
            for (const p of Object.values(comp.precomps ?? {}))
              for (const l of (p as any).layers ?? []) if (l.id === layerId) return !l.hidden;
            return true;
          },
        });
        o.onPick(id ? (selectionFromLayerId(comp, id) ?? undefined) : undefined);
      };
      stage.on('pointerdown', handler);
      cleanup = () => {
        stage?.off('pointerdown', handler);
        stage.eventMode = oldMode;
        stage.hitArea = oldArea;
      };
    };
    let cleanup = () => {};
    attach(0);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      cleanup();
    };
  }, [o.player, o.comp, o.onPick]);
}
export { layerIdFromPixiTarget };
