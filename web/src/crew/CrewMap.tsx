// Owned by S12d. The crew as a live map: agents light up while they work and work visibly moves between them.
// Everything drawn comes from real crew events (crew.agent, job.update, showrunner.*), never from a script.
import { useEffect, useMemo, useState } from 'react';
import { modelLabel, type CrewLink, type CrewState } from './crewReducer';

const DOT_MS = 1500;
const TRAIL_MS = 4000;
const W = 680;
const H = 380;

interface NodeSpec {
  id: string;
  x: number;
  y: number;
  title: string;
  model: string;
  state: 'idle' | 'thinking' | 'working' | 'waiting';
  job?: string;
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function layout(crew: CrewState): NodeSpec[] {
  const lane = (key: string) => crew.lanes[key];
  const jobOf = (key: string) => {
    const id = lane(key)?.jobId;
    const j = id ? crew.jobs[id] : undefined;
    return j && lane(key)?.state !== 'idle' ? `${j.kind.replace('-scene', '')}${j.sceneId ? ` ${j.sceneId}` : ''}` : undefined;
  };
  const fixed = (id: string, x: number, y: number, title: string, laneName: Parameters<typeof modelLabel>[1]): NodeSpec => ({
    id, x, y, title, model: modelLabel(lane(id)?.model, laneName), state: lane(id)?.state ?? 'idle', job: jobOf(id),
  });
  const builders = Object.entries(crew.lanes).filter(([, l]) => l.lane === 'builder').map(([w]) => w).sort();
  const n = builders.length;
  const nodes: NodeSpec[] = [
    { id: 'you', x: 70, y: 190, title: 'You', model: 'the director', state: 'idle' },
    fixed('showrunner', 290, 190, 'Showrunner', 'showrunner'),
    fixed('critic', 240, 330, 'Critic', 'critic'),
    fixed('continuity', 370, 330, 'Continuity', 'continuity'),
    fixed('producer', 215, 50, 'Producer', 'producer'),
    fixed('listener', 320, 34, 'Listener', 'listener'),
    fixed('local', 425, 50, 'Local', 'local'),
    ...builders.map((w, i) => {
      const a = n === 1 ? 0 : -0.95 + (1.9 * i) / (n - 1);
      return { id: `builder:${w}`, x: 530 + Math.cos(a) * 60, y: 190 + Math.sin(a) * 135, title: `Builder ${i + 1}`, model: modelLabel(lane(w)?.model, 'builder'), state: lane(w)?.state ?? 'idle', job: jobOf(w) } as NodeSpec;
    }),
  ];
  return nodes;
}

export function CrewMap({ crew, now: nowProp }: { crew: CrewState; now?: number }) {
  const [tick, setTick] = useState(() => Date.now());
  const controlled = nowProp !== undefined;
  const now = controlled ? nowProp : tick;
  const recent = crew.links.filter((l) => now - Date.parse(l.at) < TRAIL_MS);
  const animating = recent.length > 0;
  // a fast clock only while something is travelling; at rest the map costs nothing
  useEffect(() => {
    if (controlled || !animating) return;
    const id = setInterval(() => setTick(Date.now()), 250);
    return () => clearInterval(id);
  }, [controlled, animating]);

  const reduced = useMemo(prefersReducedMotion, []);
  const nodes = useMemo(() => layout(crew), [crew]);
  const at = (id: string) => nodes.find((n) => n.id === id);
  const last = crew.links.at(-1);

  const edge = (l: CrewLink) => {
    const a = at(l.from);
    const b = at(l.to);
    return a && b ? { a, b } : null;
  };

  return (
    <div className="crew-map">
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Crew map" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="glow-working"><stop offset="0%" stopColor="var(--c-working)" stopOpacity=".55" /><stop offset="100%" stopColor="var(--c-working)" stopOpacity="0" /></radialGradient>
          <radialGradient id="glow-thinking"><stop offset="0%" stopColor="var(--c-thinking)" stopOpacity=".55" /><stop offset="100%" stopColor="var(--c-thinking)" stopOpacity="0" /></radialGradient>
        </defs>
        {nodes.filter((n) => n.id !== 'showrunner' && n.id !== 'you').map((n) => (
          <line key={`rest-${n.id}`} className="map-rest" x1={at('showrunner')!.x} y1={at('showrunner')!.y} x2={n.x} y2={n.y} />
        ))}
        <line className="map-rest" x1={at('you')!.x} y1={at('you')!.y} x2={at('showrunner')!.x} y2={at('showrunner')!.y} />
        {recent.map((l) => {
          const e = edge(l);
          if (!e) return null;
          const age = now - Date.parse(l.at);
          const path = `M${e.a.x},${e.a.y} L${e.b.x},${e.b.y}`;
          return (
            <g key={l.id} className={`map-link kind-${l.kind}`} style={{ opacity: Math.max(0.15, 1 - age / TRAIL_MS) }}>
              <path className="map-trail" d={path} />
              {!reduced && age < DOT_MS && (
                <circle className="map-dot" r="6">
                  <animateMotion dur={`${(DOT_MS - age) / 1000}s`} path={path} fill="freeze" />
                </circle>
              )}
            </g>
          );
        })}
        {nodes.map((n) => {
          const lit = n.state === 'thinking' || n.state === 'working';
          const label = `${n.title}, ${n.state}${n.job ? `: ${n.job}` : ''}`;
          return (
            <g key={n.id} className={`map-node is-${n.state}${lit ? ' is-lit' : ''}`} transform={`translate(${n.x} ${n.y})`} role="img" aria-label={label} data-node={n.id}>
              {lit && <circle className="map-glow" r="46" fill={`url(#glow-${n.state})`} />}
              <circle className="map-body" r={n.id === 'showrunner' ? 30 : 22} />
              <text className="map-initial" textAnchor="middle" dy=".35em">{n.id === 'you' ? 'You' : n.id.startsWith('builder:') ? `B${n.title.replace('Builder ', '')}` : n.title[0]}</text>
              <text className="map-title" textAnchor="middle" y={n.id === 'showrunner' ? 48 : 38}>{n.title}</text>
              <text className="map-sub" textAnchor="middle" y={n.id === 'showrunner' ? 61 : 51}>{n.job ?? n.model}</text>
            </g>
          );
        })}
      </svg>
      <p className="visually-hidden" aria-live="polite">
        {last ? (last.kind === 'message' || last.kind === 'edit' ? 'Your message reached the showrunner.' : last.kind === 'dispatch' ? `Dispatched ${last.label ?? 'a job'}.` : '') : ''}
      </p>
    </div>
  );
}
