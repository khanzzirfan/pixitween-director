// Owned by S12b. What the showrunner sees each turn (design.md 5.7 and 6.2): the board, the new inbox items, and older turns folded into a paragraph.
import type { InboxItem, Job } from '@shared/crew';
import type { FilmEvent } from '@shared/events';
import type { ChatMessage, ContentPart } from '@shared/ports';
import type { Storyboard } from '@shared/storyboard';
import { TERMINAL } from './board';

export interface Finding {
  sceneId: string;
  atSec?: number;
  kind: string;
  text: string;
  source?: 'critic' | 'continuity';
}

export interface TurnView {
  storyboard: Storyboard;
  rev: number;
  jobs: Job[];
  /** Findings no one has acted on yet. */
  findings: Finding[];
  budget: { spentUsd: number; capUsd: number };
  inbox: InboxItem[];
  /** The director's messages, newest first; never compacted (S12f). */
  requests?: string[];
  /** CREW_MAX_FIXES_PER_SCENE */
  maxFixes?: number;
}

const WRITING_SHORT: Record<string, string> = {
  'build-scene': 'build', 'rebuild-scene': 'rebuild', 'restyle-scene': 'restyle', edit: 'edit', fix: 'fix', take: 'take', critique: 'critique', continuity: 'continuity', revert: 'revert',
};
const clock = (iso: string) => /T(\d\d:\d\d:\d\d)/.exec(iso)?.[1] ?? iso;
const secs = (ms?: number) => (ms === undefined ? '' : ` ${Math.round(ms / 1000)}s`);

function sceneStatus(sceneJobs: Job[], mode: string): string {
  const live = sceneJobs.find((j) => j.status === 'running' || j.status === 'awaiting-frames');
  if (live) return 'building';
  if (sceneJobs.some((j) => j.status === 'queued')) return 'queued';
  const lastWriting = [...sceneJobs].reverse().find((j) => j.kind !== 'critique' && j.kind !== 'continuity' && TERMINAL.includes(j.status));
  if (lastWriting?.status === 'done') return 'done';
  if (lastWriting?.status === 'failed') return 'failed';
  return mode === 'generate' ? 'proposed' : 'queued';
}

function lastJob(sceneJobs: Job[]): string {
  const j = sceneJobs.at(-1);
  if (!j) return '-';
  const mark = j.status === 'done' ? '✓' : j.status === 'running' || j.status === 'awaiting-frames' ? '⟳' : j.status === 'failed' ? '✗' : '·';
  return `${WRITING_SHORT[j.kind] ?? j.kind} ${mark}${j.status === 'running' ? '' : secs(j.ms)}`.trim();
}

/** The BOARD table and the NEW IN YOUR INBOX list that make one user message to the showrunner. */
export function renderTurn(v: TurnView): string {
  const running = v.jobs.filter((j) => j.status === 'running' || j.status === 'awaiting-frames').length;
  const queued = v.jobs.filter((j) => j.status === 'queued').length;
  const lines = ["DIRECTOR'S REQUESTS (newest first; they outrank the original brief)", ...(v.requests?.length ? v.requests : ['(none yet)']), '', `BOARD  rev ${v.rev} · $${v.budget.spentUsd.toFixed(2)} of $${v.budget.capUsd.toFixed(2)} · ${running} running · ${queued} queued`, 'scene | dur | mode   | status      | last job           | fixes | open findings'];
  for (const s of v.storyboard.scenes) {
    const sceneJobs = v.jobs.filter((j) => j.sceneId === s.id);
    const found = v.findings
      .filter((f) => f.sceneId === s.id)
      .map((f) => `${f.source ?? 'critic'}${f.atSec !== undefined ? ` ${f.atSec}s` : ''} ${f.kind} "${f.text}"`)
      .join('; ');
    const fixes = sceneJobs.filter((j) => j.kind === 'fix' && j.status !== 'cancelled').length;
    lines.push(`${s.id} | ${s.durationSec}s | ${s.mode === 'generate' ? 'gen' : s.mode}${' '.repeat(Math.max(0, 6 - (s.mode === 'generate' ? 3 : s.mode.length)))} | ${sceneStatus(sceneJobs, s.mode).padEnd(11)} | ${lastJob(sceneJobs).padEnd(18)} | ${`${fixes}/${v.maxFixes ?? 3}`.padEnd(5)} | ${found || '-'}`);
  }
  lines.push('', 'NEW IN YOUR INBOX');
  if (!v.inbox.length) lines.push('(nothing new)');
  for (const i of v.inbox) {
    if (i.from === 'user') lines.push(`[user ${clock(i.at)}] ${i.text} (selection: ${i.selection?.layerId ?? i.selection?.sceneId ?? 'none'})`);
    else lines.push(`[${i.from}${i.jobId ? ` ${i.jobId}` : ''}] ${i.text}`);
  }
  return lines.join('\n');
}

/** The director's requests as the never-compacted block the showrunner sees above the board. */
export function directorRequests(events: readonly FilmEvent[]): string[] {
  return events
    .filter((e): e is Extract<FilmEvent, { type: 'showrunner.heard' }> => e.type === 'showrunner.heard' && e.from === 'user')
    .slice(-10)
    .reverse()
    .map((e) => `[${clock(e.at)}] ${e.text.slice(0, 160)}`);
}

const STORY_MAX = 1200;

/** One paragraph of what has happened so far, from the event log. The newest facts survive when it has to be cut. */
export function storySoFar(events: readonly FilmEvent[]): string {
  const facts: string[] = [];
  let prevIds: string[] = [];
  for (const e of events) {
    if (e.type === 'storyboard.revised') {
      const ids = e.storyboard.scenes.map((s) => s.id);
      const added = ids.filter((id) => !prevIds.includes(id));
      const removed = prevIds.filter((id) => !ids.includes(id));
      facts.push(`Storyboard rev ${e.rev} (${e.source}): ${ids.join(', ')}${added.length && prevIds.length ? `, added ${added.join(', ')}` : ''}${removed.length ? `, removed ${removed.join(', ')}` : ''}.`);
      prevIds = ids;
    } else if (e.type === 'showrunner.heard' && e.from === 'user') {
      facts.push(`The user asked: "${e.text.slice(0, 160)}".`);
    } else if (e.type === 'take.ready') {
      facts.push(`Take ${e.label} for ${e.sceneId} is ready${e.score !== undefined ? ` (score ${e.score})` : ''}.`);
    }
  }
  let text = facts.join(' ');
  while (text.length > STORY_MAX && facts.length > 1) {
    facts.shift();
    text = `… ${facts.join(' ')}`;
  }
  return text.length > STORY_MAX ? `${text.slice(0, STORY_MAX - 1)}…` : text;
}

const withoutImages = (m: ChatMessage): ChatMessage => {
  if (!Array.isArray(m.content)) return m;
  const parts: ContentPart[] = m.content.filter((p) => p.type !== 'image_url');
  return { ...m, content: parts.length === 1 && parts[0]!.type === 'text' ? parts[0]!.text : parts };
};

/**
 * Keeps the system message, folds every turn older than the last `keepTurns` into one STORY SO FAR message,
 * and drops the product photo once there is more than one turn (the bible's productLine replaces it).
 * A turn starts at a user message; the assistant calls and tool results after it stay with it.
 */
export function compact(messages: readonly ChatMessage[], keepTurns = 8, story = ''): ChatMessage[] {
  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  const turns: ChatMessage[][] = [];
  for (const m of rest) {
    if (m.role === 'user' || !turns.length) turns.push([m]);
    else turns.at(-1)!.push(m);
  }
  const kept = turns.slice(-keepTurns);
  const folded = turns.length > kept.length;
  const body = kept.flat();
  return [...system, ...(folded ? [{ role: 'user', content: `STORY SO FAR\n${story || '(earlier turns omitted)'}` } as ChatMessage] : []), ...(turns.length > 1 ? body.map(withoutImages) : body)];
}
