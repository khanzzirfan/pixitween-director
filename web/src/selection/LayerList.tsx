import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import type { EditSelection } from './useSelection';
type Scene = { id: string; startFrame: number; durationFrames: number; mode: string };
export function LayerList({
  comp,
  selection,
  onSelect,
}: {
  comp: AepCompositionJson | undefined;
  selection?: EditSelection;
  onSelect(s: EditSelection): void;
}) {
  if (!comp) return <p>No layers yet</p>;
  const d = (comp.meta as any)?.director ?? {};
  const scenes = Object.entries(d.scenes ?? {})
    .map(([id, m]: [string, any]) => ({ ...(m as Scene), id }))
    .sort((a, b) => a.startFrame - b.startFrame);
  return (
    <div>
      {scenes.map((scene) => (
        <section key={scene.id}>
          <button
            type="button"
            aria-pressed={selection?.sceneId === scene.id && !selection.layerId}
            onClick={() => onSelect({ sceneId: scene.id })}
          >
            {scene.id} · {(scene.durationFrames / comp.fps).toFixed(1)}s · {(scene.mode ?? 'motion').toUpperCase()}
          </button>
          {((comp.precomps?.[scene.id] as any)?.layers ?? []).map((layer: any) => (
            <button
              key={layer.id}
              type="button"
              aria-pressed={selection?.layerId === layer.id}
              onClick={() => onSelect({ sceneId: scene.id, layerId: layer.id })}
            >
              {layer.id} · {d.layers?.[layer.id]?.role ?? layer.kind}
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}
