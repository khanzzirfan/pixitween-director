// Owned by S12d. One pure fold from the event stream to the crew's state, so the live view and a replay agree.
import type { Job, Lane } from '@shared/crew';
import type { FilmEvent } from '@shared/events';
import type { Storyboard } from '@shared/storyboard';
import type { StyleBible } from '@shared/crew';
import { linkFor, type LinkKind } from './topology';

export type AgentState = 'idle' | 'thinking' | 'working' | 'waiting';
export interface LaneState {
  lane: Lane;
  state: AgentState;
  jobId?: string;
  model?: string;
  note?: string;
  /** When the lane entered this state (the event's own time). */
  since: string;
}
export interface Note {
  at: string;
  kind: 'note' | 'reply' | 'ask';
  text: string;
  options?: string[];
}
export interface Heard {
  inboxId: string;
  text: string;
  at: string;
}
export interface TakeReady {
  jobId: string;
  takeOf: string;
  sceneId: string;
  label: 'A' | 'B' | 'C';
  takeFilmId: string;
  thumbAssetId?: string;
  score?: number;
  note?: string;
}
export interface CaptureRequest {
  requestId: string;
  sceneId: string;
  timesSec: number[];
  at: string;
}
export interface CrewLink {
  id: string;
  from: string;
  to: string;
  kind: LinkKind;
  label?: string;
  at: string;
}
export interface Finding {
  sceneId: string;
  kind: string;
  evidence: string;
  deterministic: boolean;
  at: string;
}

export interface CrewState {
  lanes: Record<string, LaneState>;
  jobs: Record<string, Job>;
  notes: Note[];
  heard: Heard[];
  storyboard?: Storyboard;
  rev: number;
  /** Scenes the latest revision added, and when. */
  fresh: { ids: string[]; at: string };
  bible?: StyleBible;
  takes: Record<string, TakeReady[]>;
  pickedTake?: string;
  budget?: { spentUsd: number; capUsd: number; level: 'ok' | 'warn' | 'stop' };
  credits: number;
  /** Dollars per model name, from cost events. */
  costByModel: Record<string, number>;
  captureRequests: CaptureRequest[];
  findings: Finding[];
  links: CrewLink[];
  status?: string;
  /** The film time of the latest event, so a replay's clock starts there. */
  lastAt?: string;
}

export const MAX_LINKS = 24;
export const initialCrewState: CrewState = {
  lanes: {},
  jobs: {},
  notes: [],
  heard: [],
  rev: 0,
  fresh: { ids: [], at: '' },
  takes: {},
  credits: 0,
  costByModel: {},
  captureRequests: [],
  findings: [],
  links: [],
};

/** Returns the same object for events the crew view does not read. */
export function crewReducer(state: CrewState, e: FilmEvent): CrewState {
  const link = linkFor(e);
  const withLink = (next: CrewState): CrewState =>
    link ? { ...next, links: [...next.links, { id: `${e.at}#${next.links.length}:${state.links.length}`, ...link, at: e.at }].slice(-MAX_LINKS) } : next;

  switch (e.type) {
    case 'crew.agent': {
      const prev = state.lanes[e.worker];
      const changed = !prev || prev.state !== e.state;
      return {
        ...state,
        lanes: {
          ...state.lanes,
          [e.worker]: {
            lane: e.lane,
            state: e.state,
            ...(e.jobId ? { jobId: e.jobId } : {}),
            ...((e.model ?? prev?.model) ? { model: e.model ?? prev?.model } : {}),
            ...(e.note ? { note: e.note } : {}),
            since: changed ? e.at : prev.since,
          },
        },
      };
    }
    case 'job.update':
      return withLink({ ...state, jobs: { ...state.jobs, [e.job.id]: e.job } });
    case 'showrunner.heard':
      return withLink(e.from === 'user' ? { ...state, heard: [...state.heard, { inboxId: e.inboxId, text: e.text, at: e.at }] } : state);
    case 'showrunner.say':
      return withLink({ ...state, notes: [...state.notes, { at: e.at, kind: e.kind, text: e.text, ...(e.options ? { options: e.options } : {}) }] });
    case 'storyboard.revised': {
      const had = new Set(state.storyboard?.scenes.map((s) => s.id));
      const added = e.storyboard.scenes.map((s) => s.id).filter((id) => !had.has(id));
      return withLink({ ...state, storyboard: e.storyboard, rev: e.rev, fresh: state.storyboard ? { ids: added, at: e.at } : { ids: [], at: e.at } });
    }
    case 'director.storyboard':
      return { ...state, storyboard: e.storyboard };
    case 'style.bible':
      return { ...state, bible: e.bible };
    case 'take.ready': {
      const { type: _t, filmId: _f, at: _a, ...take } = e;
      const rest = (state.takes[e.takeOf] ?? []).filter((t) => t.label !== e.label);
      return { ...state, takes: { ...state.takes, [e.takeOf]: [...rest, take].sort((a, b) => a.label.localeCompare(b.label)) } };
    }
    case 'budget':
      return { ...state, budget: { spentUsd: e.spentUsd, capUsd: e.capUsd, level: e.level } };
    case 'cost':
      return { ...state, credits: state.credits + (e.credits ?? 0), costByModel: { ...state.costByModel, [e.model]: (state.costByModel[e.model] ?? 0) + e.usd } };
    case 'capture.request':
      return { ...state, captureRequests: [...state.captureRequests, { requestId: e.requestId, sceneId: e.sceneId, timesSec: e.timesSec, at: e.at }] };
    case 'review.finding':
      return withLink({ ...state, findings: [...state.findings, { sceneId: e.sceneId, kind: e.kind, evidence: e.evidence, deterministic: e.deterministic, at: e.at }] });
    default:
      return state;
  }
}

export const foldCrew = (events: readonly FilmEvent[]): CrewState => events.reduce(crewReducer, initialCrewState);

export const MODEL_LABELS: Array<[RegExp, string]> = [
  [/wonder/i, 'Muse Wonder'],
  [/spark/i, 'Muse Spark'],
  [/glimmer/i, 'Muse Glimmer'],
  [/rules/i, 'rules'],
];
export function modelLabel(model: string | undefined, lane: Lane): string {
  const hit = model ? MODEL_LABELS.find(([re]) => re.test(model)) : undefined;
  if (hit) return hit[1];
  return lane === 'showrunner' ? 'Muse Wonder' : lane === 'continuity' ? 'rules' : lane === 'local' ? 'Muse Glimmer' : lane === 'producer' || lane === 'listener' ? 'rules' : 'Muse Spark';
}
