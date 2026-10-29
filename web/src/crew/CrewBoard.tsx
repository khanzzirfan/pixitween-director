// Owned by S12d. The crew at work: one lane per agent (or the same crew as a live map).
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Job, Lane } from '@shared/crew';
import { CrewMap } from './CrewMap';
import { modelLabel, type CrewState, type LaneState } from './crewReducer';
import { cents, secondsSince } from './format';
import { JobChip } from './JobChip';

const VIEW_KEY = 'crew.view';
type View = 'lanes' | 'map';
const FIXED: Array<{ key: string; lane: Lane; name: string }> = [
  { key: 'showrunner', lane: 'showrunner', name: 'Showrunner' },
  { key: 'critic', lane: 'critic', name: 'Critic' },
  { key: 'continuity', lane: 'continuity', name: 'Continuity' },
  { key: 'producer', lane: 'producer', name: 'Producer' },
  { key: 'listener', lane: 'listener', name: 'Listener' },
  { key: 'local', lane: 'local', name: 'Local' },
];

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'map' ? 'map' : 'lanes';
  } catch {
    return 'lanes';
  }
}

interface Row {
  key: string;
  lane: Lane;
  name: string;
  state?: LaneState;
  jobs: Job[];
  costUsd: number;
}

export function buildRows(crew: CrewState): Row[] {
  const jobs = Object.values(crew.jobs);
  const builders = Object.entries(crew.lanes).filter(([, l]) => l.lane === 'builder').map(([w]) => w).sort();
  const laneJobs = (key: string, lane: Lane) =>
    jobs.filter((j) => (lane === 'critic' ? j.kind === 'critique' : lane === 'continuity' ? j.kind === 'continuity' : lane === 'builder' ? j.worker === key && j.kind !== 'critique' && j.kind !== 'continuity' : lane === 'local' ? j.worker === 'local' : false));
  const fixedRow = (f: (typeof FIXED)[number]): Row => {
      const js = laneJobs(f.key, f.lane);
      const wonder = Object.entries(crew.costByModel).filter(([m]) => /wonder/i.test(m)).reduce((n, [, v]) => n + v, 0);
      return { ...f, state: crew.lanes[f.key], jobs: js, costUsd: f.lane === 'showrunner' ? wonder : js.reduce((n, j) => n + j.costUsd, 0) };
  };
  const builderRows: Row[] = builders.map((w, i) => {
    const js = laneJobs(w, 'builder');
    return { key: w, lane: 'builder' as Lane, name: `Builder ${i + 1}`, state: crew.lanes[w], jobs: js, costUsd: js.reduce((n, j) => n + j.costUsd, 0) };
  });
  // the showrunner first, then the builders doing the work, then the checkers; lanes that never spoke stay visible but quiet
  return [fixedRow(FIXED[0]!), ...builderRows, ...FIXED.slice(1).map(fixedRow)];
}

function LaneRow({ row, now, onCancel }: { row: Row; now: number; onCancel?: (id: string) => void }) {
  const st = row.state?.state ?? 'idle';
  const secs = st === 'idle' ? null : secondsSince(row.state?.since, now);
  const chips = row.jobs.slice(-5).reverse();
  return (
    <li className={`lane lane-${row.lane} is-${st}`} data-lane={row.key}>
      <div className="lane-head">
        <span className="lane-dot" aria-hidden="true" />
        <span className="lane-name">{row.name}</span>
        <span className="lane-model">{modelLabel(row.state?.model, row.lane)}</span>
        <span className={`state-pill st-${st}`}>{st}</span>
        {secs !== null && <span className="lane-secs">{secs} s</span>}
        <span className="lane-cost">{cents(row.costUsd)}</span>
      </div>
      {row.state?.note && <p className="lane-note">{row.state.note}</p>}
      {chips.length > 0 && (
        <div className="lane-chips">
          {chips.map((j) => (
            <JobChip key={j.id} job={j} onCancel={onCancel} />
          ))}
        </div>
      )}
    </li>
  );
}

export function CrewBoard({ crew, now = Date.now(), onCancel }: { crew: CrewState; now?: number; onCancel?: (jobId: string) => void }) {
  const [view, setView] = useState<View>(readView);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  const choose = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* storage may be unavailable */
    }
  };
  const order: View[] = ['lanes', 'map'];
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = order[(order.indexOf(view) + (e.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length]!;
    choose(next);
    tabs.current[order.indexOf(next)]?.focus();
  };
  const rows = buildRows(crew);
  const busy = rows.filter((r) => r.state && r.state.state !== 'idle').length;
  return (
    <section className="crew-board" aria-label="Crew">
      <header className="crew-head">
        <div>
          <span className="eyebrow">THE CREW</span>
          <h2>{busy ? `${busy} at work` : 'Standing by'}</h2>
        </div>
        <div className="seg" role="tablist" aria-label="Crew view" onKeyDown={onKey}>
          {order.map((v, i) => (
            <button
              key={v}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-${v}`}
              aria-selected={view === v}
              tabIndex={view === v ? 0 : -1}
              className={view === v ? 'is-on' : ''}
              onClick={() => choose(v)}
            >
              {v === 'lanes' ? 'Lanes' : 'Map'}
            </button>
          ))}
        </div>
      </header>
      <div role="tabpanel" aria-labelledby={`${id}-${view}`}>
        {view === 'lanes' ? (
          <ul className="lanes">
            {rows.map((r) => (
              <LaneRow key={r.key} row={r} now={now} onCancel={onCancel} />
            ))}
          </ul>
        ) : (
          <CrewMap crew={crew} now={now} />
        )}
      </div>
    </section>
  );
}
