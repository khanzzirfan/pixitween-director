// Owned by S12d. The storyboard as cards that change as the crew works. The user edits them in place; every edit is one op.
import { useEffect, useRef, useState, Fragment } from 'react';
import { SHEET_STEPS } from '@shared/crew';
import type { StoryboardOp } from '@shared/crew';
import type { Scene } from '@shared/storyboard';
import type { CrewState } from './crewReducer';
import { SceneCard, ringFor } from './SceneCard';

export const NEW_GLOW_MS = 2000;
const MIN_SCENES = 2;

const newScene = (intent: string): Omit<Scene, 'id'> => ({
  durationSec: 4,
  intent,
  shotType: 'detail',
  camera: 'static',
  layersWanted: ['bg', 'product', 'headline'],
  mode: 'motion',
  modeReason: 'added by the director',
});

function AddSlot({ onAdd }: { onAdd(intent: string): void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  if (!open)
    return (
      <button type="button" className="add-slot" aria-label="Add a scene here" onClick={() => setOpen(true)}>
        <span aria-hidden="true">+</span>
      </button>
    );
  const submit = () => {
    const v = text.trim();
    if (v) onAdd(v);
    setText('');
    setOpen(false);
  };
  return (
    <form className="add-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <input autoFocus aria-label="New scene intent" placeholder="What happens in this scene?" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
      <button type="submit" className="primary" disabled={!text.trim()}>Add</button>
    </form>
  );
}

/** What the 3D film is doing right now, from the showrunner's own crew events: the step, how long it has run, and the steps before it. */
function BuildProgress({ crew }: { crew: CrewState }) {
  const [tick, setTick] = useState(() => Date.now());
  const lane = crew.lanes.showrunner;
  const step = SHEET_STEPS.findIndex((s) => s.label === lane?.note);
  const active = !!lane && lane.state !== 'idle' && step >= 0;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  if (!active) return <div className="empty-state"><span className="pulse-dot" aria-hidden="true" />The showrunner is sketching the plan…</div>;
  const secs = Math.max(0, Math.round((tick - Date.parse(lane.since)) / 1000));
  const last = crew.notes.at(-1);
  return (
    <div className="build-progress" role="status" aria-live="polite">
      <p className="build-now"><span className="pulse-dot" aria-hidden="true" />{SHEET_STEPS[step]!.label}… <span className="build-secs">{secs} s</span></p>
      <ol className="build-steps" aria-label="Film steps">
        {SHEET_STEPS.map((s, i) => (
          <li key={s.id} className={i < step ? 'is-done' : i === step ? 'is-now' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="build-dot" aria-hidden="true">{i < step ? '✓' : i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>
      {last && <p className="build-last">{last.text}</p>}
    </div>
  );
}

/** Without onOps the storyboard is a replay's: nothing on it can be edited. `stored` is the film's own plan, shown when no revision came as an event (a 3D film writes its plan in one go). */
export function LiveStoryboard({ crew, now = Date.now(), onOps, onRebuild, filmStatus, stored }: { crew: CrewState; now?: number; onOps?(ops: StoryboardOp[]): Promise<unknown> | void; onRebuild?(sceneId: string): Promise<unknown> | void; filmStatus?: string; stored?: Scene[] }) {
  const scenes = crew.storyboard?.scenes ?? stored ?? [];
  const jobs = Object.values(crew.jobs);
  const dragged = useRef<string | null>(null);
  const [error, setError] = useState('');
  const send = async (ops: StoryboardOp[]) => {
    setError('');
    try {
      await onOps?.(ops);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The edit was refused.');
    }
  };
  const freshAt = Date.parse(crew.fresh.at);
  const ids = scenes.map((s) => s.id);

  const move = (sceneId: string, dir: -1 | 1) => {
    const i = ids.indexOf(sceneId);
    const after = dir === -1 ? (ids[i - 2] ?? null) : (ids[i + 1] ?? null);
    void send([{ op: 'move', sceneId, after }]);
  };
  const dropOn = (targetId: string) => {
    const from = dragged.current;
    dragged.current = null;
    if (!from || from === targetId) return;
    const rest = ids.filter((i) => i !== from);
    const at = rest.indexOf(targetId);
    void send([{ op: 'move', sceneId: from, after: rest[at - 1] ?? null }]);
  };
  const rebuild = async (sceneId: string) => {
    setError('');
    try {
      await onRebuild?.(sceneId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The shot could not be regenerated.');
    }
  };
  const remove = (sceneId: string) => {
    if (typeof window.confirm === 'function' && !window.confirm(`Remove ${sceneId}? Its work is stopped.`)) return;
    void send([{ op: 'remove', sceneId }]);
  };
  const addAfter = (after: string | null, intent: string) => void send([{ op: 'add', scene: newScene(intent), after }]);
  const total = scenes.reduce((n, s) => n + s.durationSec, 0);

  return (
    <section className="live-storyboard" aria-label="Storyboard">
      <header className="crew-head">
        <div>
          <span className="eyebrow">THE PLAN</span>
          <h2>Storyboard</h2>
        </div>
        {scenes.length > 0 && <span className="sb-total">{scenes.length} scenes · {total} s · rev {crew.rev}</span>}
      </header>
      {error && <p role="alert" className="crew-error">{error}</p>}
      {scenes.length === 0 ? (
        <BuildProgress crew={crew} />
      ) : (
        <div className="cards">
          {onOps && <AddSlot onAdd={(t) => addAfter(null, t)} />}
          {scenes.map((s, i) => (
            <Fragment key={s.id}>
              <SceneCard
                scene={s}
                index={i}
                total={scenes.length}
                ring={ringFor(jobs, s.id, filmStatus)}
                isNew={crew.fresh.ids.includes(s.id) && now - freshAt < NEW_GLOW_MS}
                canRemove={scenes.length > MIN_SCENES}
                onPatch={(sceneId, patch) => void send([{ op: 'update', sceneId, patch }])}
                onRemove={remove}
                {...(onRebuild ? { onRebuild: rebuild } : {})}
                onMove={move}
                onDragStart={(id) => { dragged.current = id; }}
                onDropOn={dropOn}
                readOnly={!onOps}
              />
              {onOps && <AddSlot onAdd={(t) => addAfter(s.id, t)} />}
            </Fragment>
          ))}
        </div>
      )}
    </section>
  );
}
