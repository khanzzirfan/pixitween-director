import { useEffect } from 'react';
import type { AepCompositionJson } from '@shared/aep';
import type { PlayerHandle } from '../player/Player';
import { selectionFromLayerId } from './pixiTarget';
import type { EditSelection } from './useSelection';
export function useCanvasSelect(o: {
  player?: PlayerHandle | null;
  comp?: AepCompositionJson | null;
  onPick(s: EditSelection | undefined): void;
}): void {
  useEffect(() => {
    if (!o.player) return;
    const player = o.player;
    if (player.pick) {
      // pick on the canvas and map the pointer to doc pixels.
      const canvas = player.getCanvas();
      if (!canvas) return;
      const onDown = (e: PointerEvent) => {
        const comp = o.comp;
        const rect = canvas.getBoundingClientRect();
        if (!comp || !rect.width || !rect.height) return o.onPick(undefined);
        const id = player.pick!(((e.clientX - rect.left) / rect.width) * canvas.width, ((e.clientY - rect.top) / rect.height) * canvas.height);
        o.onPick(id ? (selectionFromLayerId(comp, id) ?? undefined) : undefined);
      };
      canvas.addEventListener('pointerdown', onDown);
      return () => canvas.removeEventListener('pointerdown', onDown);
    }
  }, [o.player, o.comp, o.onPick]);
}
