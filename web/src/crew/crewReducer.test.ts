import { describe, expect, it } from 'vitest';
import type { FilmEvent } from '@shared/events';
import { crewReducer, foldCrew, initialCrewState, modelLabel } from './crewReducer';
import { linkFor } from './topology';
import { FIXTURE, MARKS, upTo } from './test-fixture';

describe('crewReducer', () => {
  it('folds the fixture to 5 scenes at rev 2 and 3 takes under the take job id', () => {
    const s = foldCrew(FIXTURE);
    expect(s.storyboard?.scenes.map((x) => x.id)).toEqual(['s1', 's2', 's5', 's3', 's4']);
    expect(s.rev).toBe(2);
    expect(s.takes.j6).toHaveLength(3);
    expect(s.takes.j6!.map((t) => t.score)).toEqual([6, 9, 7]);
    expect(s.budget).toEqual({ spentUsd: 0.413, capUsd: 1.5, level: 'ok' });
    expect(s.bible?.mood).toBe('bright summery');
    expect(s.heard.map((h) => h.text)).toEqual(['add a sunset scene after scene 2']);
    expect(s.fresh.ids).toEqual(['s5']);
  });

  it('has 4 lanes working at the point where 4 builds run', () => {
    const s = foldCrew(upTo(MARKS.fourBuilds));
    const working = Object.values(s.lanes).filter((l) => l.lane === 'builder' && l.state === 'working');
    expect(working).toHaveLength(4);
  });

  it('returns the identical object for events it does not read', () => {
    const s = foldCrew(upTo(10));
    const e = { filmId: 'film_0123456789ab', at: 'x', type: 'film.status', status: 'ready' } as FilmEvent;
    expect(crewReducer(s, e)).toBe(s);
    expect(crewReducer(s, { ...e, type: 'art.asset', asset: { id: 'a', url: '/a', mime: 'image/png' } } as unknown as FilmEvent)).toBe(s);
  });

  it('keeps a lane clock until its state changes', () => {
    const s = foldCrew(FIXTURE.filter((e) => e.type === 'crew.agent' && e.worker === 'w1'));
    expect(s.lanes.w1!.state).toBe('working');
    expect(s.lanes.w1!.since).toBe('2026-10-30T14:00:20.000Z');
  });

  it('labels models', () => {
    expect(modelLabel('muse-wonder-1.0', 'showrunner')).toBe('Muse Wonder');
    expect(modelLabel('muse-spark-1.3', 'builder')).toBe('Muse Spark');
    expect(modelLabel(undefined, 'continuity')).toBe('rules');
    expect(modelLabel('glimmer', 'local')).toBe('Muse Glimmer');
  });

  it('records links from events, newest 24 only, with the event time', () => {
    const s = foldCrew(upTo(MARKS.afterUserMessage));
    expect(s.links.at(-1)).toMatchObject({ from: 'you', to: 'showrunner', kind: 'message', at: '2026-10-30T14:00:14.000Z' });
    const many = Array.from({ length: 40 }, (_, i) => ({ filmId: 'film_0123456789ab', at: `2026-10-30T14:01:${String(i).padStart(2, '0')}.000Z`, type: 'showrunner.say', kind: 'note', text: `n${i}` }) as FilmEvent);
    expect(foldCrew(many).links).toHaveLength(24);
    expect(initialCrewState.links).toHaveLength(0);
  });
});

describe('linkFor', () => {
  const at = '2026-10-30T14:00:00.000Z';
  const f = 'film_0123456789ab';
  const job = (status: string, extra = {}) => ({ id: 'j1', kind: 'build-scene', sceneId: 's3', filmId: f, brief: '', reason: '', origin: 'showrunner', status, createdAt: at, costUsd: 0, worker: 'w2', ...extra });
  const ev = (e: object) => ({ filmId: f, at, ...e }) as unknown as FilmEvent;

  it('maps the events it names', () => {
    expect(linkFor(ev({ type: 'showrunner.heard', inboxId: 'i', from: 'user', text: 'hi' }))).toEqual({ from: 'you', to: 'showrunner', kind: 'message' });
    expect(linkFor(ev({ type: 'showrunner.heard', inboxId: 'i', from: 'system', text: 'hi' }))).toBeNull();
    expect(linkFor(ev({ type: 'storyboard.revised', source: 'user', rev: 2, ops: [], storyboard: {} }))).toEqual({ from: 'you', to: 'showrunner', kind: 'edit' });
    expect(linkFor(ev({ type: 'storyboard.revised', source: 'showrunner', rev: 2, ops: [], storyboard: {} }))).toBeNull();
    expect(linkFor(ev({ type: 'job.update', job: job('running') }))).toEqual({ from: 'showrunner', to: 'builder:w2', kind: 'dispatch', label: 'build-scene s3' });
    expect(linkFor(ev({ type: 'job.update', job: job('done') }))).toMatchObject({ from: 'builder:w2', to: 'showrunner', kind: 'result' });
    for (const st of ['failed', 'cancelled', 'superseded']) expect(linkFor(ev({ type: 'job.update', job: job(st) }))).toMatchObject({ kind: 'stopped', to: 'showrunner' });
    expect(linkFor(ev({ type: 'job.update', job: job('queued') }))).toBeNull();
    expect(linkFor(ev({ type: 'job.update', job: job('running', { kind: 'critique', worker: undefined }) }))).toMatchObject({ to: 'critic' });
    expect(linkFor(ev({ type: 'review.finding', sceneId: 's1', kind: 'k', evidence: '', deterministic: false }))).toMatchObject({ from: 'critic', to: 'showrunner', kind: 'finding' });
    expect(linkFor(ev({ type: 'review.finding', sceneId: 's1', kind: 'k', evidence: '', deterministic: true }))).toMatchObject({ from: 'continuity' });
    expect(linkFor(ev({ type: 'showrunner.say', kind: 'note', text: 'x' }))).toEqual({ from: 'showrunner', to: 'you', kind: 'reply' });
  });

  it('returns null for film.status, cost and art.asset', () => {
    expect(linkFor(ev({ type: 'film.status', status: 'ready' }))).toBeNull();
    expect(linkFor(ev({ type: 'cost', usd: 1, model: 'm', units: 'u' }))).toBeNull();
    expect(linkFor(ev({ type: 'art.asset', asset: { id: 'a', url: '/a', mime: 'image/png' } }))).toBeNull();
  });
});
