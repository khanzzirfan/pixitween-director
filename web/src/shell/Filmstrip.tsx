// Owned by S14. A compact strip of scenes under the player: click one to jump to it.
import type { Scene } from '@shared/storyboard';

export type StripRing = 'queued' | 'building' | 'reviewing' | 'done' | 'failed';

export interface FilmstripProps {
  scenes: Scene[];
  ringOf?(sceneId: string): StripRing;
  selected?: string;
  onSelect(sceneId: string): void;
  onAdd?(): void;
}

/** Start time of each scene in seconds, in storyboard order. */
export function sceneStarts(scenes: Array<Pick<Scene, 'durationSec'>>): number[] {
  let t = 0;
  return scenes.map((s) => {
    const at = t;
    t += s.durationSec;
    return at;
  });
}

export function Filmstrip({ scenes, ringOf, selected, onSelect, onAdd }: FilmstripProps) {
  if (!scenes.length) return null;
  const total = scenes.reduce((n, s) => n + s.durationSec, 0);
  return (
    <div className="sh-strip" role="group" aria-label="Scenes">
      <ol className="sh-strip-list">
        {scenes.map((s, i) => {
          const ring = ringOf?.(s.id);
          return (
            <li key={s.id} style={{ flexGrow: s.durationSec }}>
              <button type="button" data-scene-chip={s.id} className={`sh-clip${selected === s.id ? ' is-on' : ''}${ring ? ` ring-${ring}` : ''}`} onClick={() => onSelect(s.id)} title={s.intent}>
                <span className="sh-clip-top">
                  <b>{i + 1}</b>
                  <i className={`sh-dot mode-${s.mode}`} title={s.mode} />
                  <span className="sh-clip-sec">{s.durationSec}s</span>
                </span>
                <span className="sh-clip-intent">{s.intent}</span>
                {ring && <span className="sh-clip-ring">{ring}</span>}
              </button>
            </li>
          );
        })}
        {onAdd && (
          <li className="sh-strip-add">
            <button type="button" aria-label="Add a scene" title="Add a scene" onClick={onAdd}>+</button>
          </li>
        )}
      </ol>
      <span className="sh-strip-total">{total}s</span>
    </div>
  );
}
