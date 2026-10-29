import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { InboxItem, Job } from '@shared/crew';
import { filmEventSchema, type FilmEvent } from '@shared/events';
import type { ChatMessage } from '@shared/ports';
import type { Scene, Storyboard } from '@shared/storyboard';
import { compact, renderTurn, storySoFar } from './history';

const events = (JSON.parse(readFileSync(new URL('../../fixtures/s12b/events-midbuild.json', import.meta.url), 'utf8')) as unknown[]).map((e) => filmEventSchema.parse(e)) as FilmEvent[];

const scene = (i: number, over: Partial<Scene> = {}): Scene => ({ id: `s${i}`, durationSec: 4, intent: 'i', shotType: 'hero', camera: 'static', layersWanted: ['bg'], mode: 'motion', modeReason: 'r', ...over });
const storyboard: Storyboard = { title: 'T', aspect: '16:9', durationSec: 16, palette: ['#111111'], scenes: [1, 2, 3, 4].map((i) => scene(i, i === 3 ? { mode: 'generate' } : {})) };
const job = (id: string, sceneId: string, status: Job['status'], over: Partial<Job> = {}): Job => ({ id, kind: 'build-scene', sceneId, filmId: 'film_aaaaaaaaaaaa', brief: 'b', reason: 'r', origin: 'auto', status, createdAt: '2026-10-30T00:00:00Z', costUsd: 0, ...over });
const inbox = (from: InboxItem['from'], text: string, over: Partial<InboxItem> = {}): InboxItem => ({ id: `i-${text.length}`, at: '2026-10-30T14:02:05.000Z', from, text, ...over });

describe('the fixture', () => {
  it('is a valid event log', () => {
    expect(events.length).toBeGreaterThan(20);
    expect(events.map((e) => e.type)).toContain('showrunner.heard');
  });
});

describe('renderTurn', () => {
  const text = renderTurn({
    storyboard, rev: 3, budget: { spentUsd: 0.41, capUsd: 1.5 },
    jobs: [job('j1', 's1', 'done', { ms: 17000 }), job('j2', 's2', 'running'), job('j3', 's4', 'queued')],
    findings: [{ sceneId: 's1', atSec: 3.2, kind: 'text-over-product', text: 'headline crosses the label' }],
    inbox: [inbox('user', 'warmer light'), inbox('job', 'build s1 done', { jobId: 'j1' }), inbox('critic', 'text over the can', { jobId: 'j6' })],
  });
  const rows = text.split('\n');

  it('has the header with rev, spend and counts', () => {
    expect(rows[0]).toBe('BOARD  rev 3 · $0.41 of $1.50 · 1 running · 1 queued');
  });
  it('has one table row per scene, with each status', () => {
    expect(rows.filter((r) => /^s\d \|/.test(r))).toHaveLength(4);
    expect(text).toMatch(/^s1 \| 4s \| motion \| done +\| build ✓ 17s +\| critic 3\.2s text-over-product "headline crosses the label"/m);
    expect(text).toMatch(/^s2 .*building +\| build ⟳/m);
    expect(text).toMatch(/^s3 \| 4s \| gen +\| proposed/m);
    expect(text).toMatch(/^s4 .*queued/m);
  });
  it('lists the inbox, the user line first on its own', () => {
    expect(rows.find((r) => r.startsWith('[user '))).toBe('[user 14:02:05] warmer light (selection: none)');
    expect(text).toContain('[job j1] build s1 done');
    expect(text).toContain('[critic j6] text over the can');
  });
  it('names a selection and says so when the inbox is empty', () => {
    expect(renderTurn({ storyboard, rev: 1, budget: { spentUsd: 0, capUsd: 1 }, jobs: [], findings: [], inbox: [inbox('user', 'bigger', { selection: { sceneId: 's2', layerId: 's2:headline' } })] })).toContain('(selection: s2:headline)');
    expect(renderTurn({ storyboard, rev: 1, budget: { spentUsd: 0, capUsd: 1 }, jobs: [], findings: [], inbox: [] })).toContain('(nothing new)');
  });
});

describe('storySoFar', () => {
  it('summarises revisions, the user request and takes from the fixture', () => {
    const s = storySoFar(events);
    expect(s).toContain('Storyboard rev 1 (showrunner): s1, s2, s3, s4.');
    expect(s).toContain('Storyboard rev 2 (showrunner): s1, s2, s5, s3, s4, added s5.');
    expect(s).toContain('The user asked: "add a sunset scene after the second one, and warmer light everywhere".');
    expect(s).toContain('Take B for s3 is ready (score 7.5).');
  });
  it('stays within 1200 characters and keeps the newest facts', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...events.find((e) => e.type === 'showrunner.heard')!, text: `request number ${i} ${'x'.repeat(100)}` })) as FilmEvent[];
    const s = storySoFar(many);
    expect(s.length).toBeLessThanOrEqual(1200);
    expect(s).toContain('request number 59');
    expect(s).not.toContain('request number 0 ');
  });
  it('is empty with no events', () => expect(storySoFar([])).toBe(''));
});

describe('compact', () => {
  const sys: ChatMessage = { role: 'system', content: 'system' };
  const turn = (n: number): ChatMessage[] => [
    { role: 'user', content: `turn ${n}` },
    { role: 'assistant', content: null, tool_calls: [{ id: `c${n}`, type: 'function', function: { name: 'say', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: `c${n}`, content: 'ok' },
  ];
  const history = (n: number) => [sys, ...Array.from({ length: n }, (_, i) => turn(i + 1)).flat()];

  it('keeps the system message, one STORY SO FAR message and the last 8 turns of 12', () => {
    const out = compact(history(12), 8, 'Things happened.');
    expect(out[0]).toBe(sys);
    expect(out[1]).toEqual({ role: 'user', content: 'STORY SO FAR\nThings happened.' });
    expect(out.filter((m) => m.role === 'user' && String(m.content).startsWith('turn '))).toHaveLength(8);
    expect(out.some((m) => m.content === 'turn 4')).toBe(false);
    expect(out.some((m) => m.content === 'turn 5')).toBe(true);
    expect(out).toHaveLength(1 + 1 + 8 * 3);
  });
  it('keeps a tool result with its call, never splitting a turn', () => {
    const out = compact(history(12), 8);
    const callIds = out.flatMap((m) => m.tool_calls?.map((c) => c.id) ?? []);
    const resultIds = out.filter((m) => m.role === 'tool').map((m) => m.tool_call_id);
    expect(resultIds).toEqual(callIds);
  });
  it('changes nothing about a short history, and adds no story message', () => {
    expect(compact(history(3), 8)).toEqual(history(3));
  });
  it('removes the planning turn image once there is more than one turn, and keeps it for the first', () => {
    const planning: ChatMessage = { role: 'user', content: [{ type: 'text', text: 'brief' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] };
    expect(JSON.stringify(compact([sys, planning], 8))).toContain('image_url');
    const later = compact([sys, planning, ...turn(2)], 8);
    expect(JSON.stringify(later)).not.toContain('image_url');
    expect(later[1]!.content).toBe('brief');
  });
});
