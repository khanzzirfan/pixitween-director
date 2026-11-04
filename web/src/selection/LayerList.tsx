import type { AepCompositionJson } from '@shared/aep';
import type { EditSelection } from './useSelection';
const ROLE_ICON: Record<string, string> = { bg: '▦', product: '◆', product3d: '◆', subject: '☻', headline: 'T', caption: 't', price: '$', clip: '▶', audio: '♪', text: 'T', image: '▣' };
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
    <div className="layer-list">
      {scenes.map((scene) => (
        <section key={scene.id} className="layer-scene">
          <button
            type="button"
            className="layer-scene-btn"
            data-mode={scene.mode ?? 'motion'}
            aria-pressed={selection?.sceneId === scene.id && !selection.layerId}
            aria-label={`${scene.id} · ${(scene.durationFrames / comp.fps).toFixed(1)}s · ${(scene.mode ?? 'motion').toUpperCase()}`}
            onClick={() => onSelect({ sceneId: scene.id })}
          >
            <span className="layer-scene-name">{scene.id}</span>
            <span className="layer-scene-mode">{scene.mode ?? 'motion'}</span>
            <span className="layer-scene-dur">{(scene.durationFrames / comp.fps).toFixed(1)}s</span>
          </button>
          <div className="layer-chips">
            {((comp.precomps?.[scene.id] as any)?.layers ?? []).map((layer: any) => {
              const role = d.layers?.[layer.id]?.role ?? layer.kind;
              return (
                <button
                  key={layer.id}
                  type="button"
                  className="layer-chip"
                  data-role={role}
                  title={`${layer.id} · ${role}`}
                  aria-label={`${layer.id} · ${role}`}
                  aria-pressed={selection?.layerId === layer.id}
                  onClick={() => onSelect({ sceneId: scene.id, layerId: layer.id })}
                >
                  <span className="layer-chip-icon" aria-hidden="true">{ROLE_ICON[role] ?? '●'}</span>
                  {role}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
