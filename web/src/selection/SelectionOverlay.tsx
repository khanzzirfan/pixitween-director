import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import type { PlayerHandle } from '../player/Player';
import type { EditSelection } from './useSelection';
export function boundsToCss(
  b: { minX: number; minY: number; maxX: number; maxY: number },
  screen: { width: number; height: number },
  rect: { left: number; top: number; width: number; height: number },
) {
  return {
    left: rect.left + (b.minX / screen.width) * rect.width,
    top: rect.top + (b.minY / screen.height) * rect.height,
    width: ((b.maxX - b.minX) / screen.width) * rect.width,
    height: ((b.maxY - b.minY) / screen.height) * rect.height,
  };
}
export function SelectionOverlay({
  player,
  comp,
  selection,
}: {
  player?: PlayerHandle | null;
  comp?: AepCompositionJson;
  selection?: EditSelection;
}) {
  const [style, setStyle] = useState<React.CSSProperties>();
  useEffect(() => {
    if (!player || !comp || !selection?.layerId) {
      setStyle(undefined);
      return;
    }
    let raf = 0,
      alive = true;
    const tick = () => {
      if (!alive) return;
      const app = player.getApp();
      const scene = (comp.meta as any)?.director?.scenes?.[selection.sceneId ?? ''];
      const time = player.getTime();
      const active = !scene || (time >= scene.startFrame / comp.fps && time < (scene.startFrame + scene.durationFrames) / comp.fps);
      const node = active ? app?.stage.getChildByLabel?.(`container-${selection.layerId}`, true) : null;
      const bounds = node?.getBounds?.();
      const canvas = player.getCanvas()?.getBoundingClientRect();
      if (bounds && canvas && app)
        setStyle(boundsToCss(bounds, app.screen, { left: canvas.left, top: canvas.top, width: canvas.width, height: canvas.height }));
      else setStyle(undefined);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [player, comp, selection]);
  return style
    ? createPortal(
        <div
          aria-hidden="true"
          style={{ position: 'fixed', pointerEvents: 'none', border: '2px solid var(--accent)', zIndex: 9999, ...style }}
        />,
        document.body,
      )
    : null;
}
