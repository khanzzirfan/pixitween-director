import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMotionDoc, type MotionDocInput } from '../schema';
import { qaDoc } from './qa';

function parse(layers: unknown[], extra: Record<string, unknown> = {}) {
  const result = parseMotionDoc({
    version: 1,
    width: 1920,
    height: 1080,
    fps: 10,
    duration: 4,
    layers,
    ...extra,
  } as MotionDocInput);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

const text = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'text',
  text: 'Hello world',
  x: 960,
  y: 540,
  start: 0,
  end: 4,
  style: { fontSize: 64 },
  ...extra,
});

describe('qaDoc', () => {
  it('passes a clean doc', () => {
    const report = qaDoc(parse([text('a'), { id: 'bg', type: 'shape', shape: 'rect', width: 1920, height: 1080, x: 960, y: 540, end: 4 }]));
    expect(report).toEqual({ ok: true, groups: [], warnings: [] });
  });

  it('flags OFFSTAGE with an x inside the stage', () => {
    const report = qaDoc(parse([text('a', { x: 2400 })]));
    expect(report.ok).toBe(false);
    const g = report.groups.filter((x) => x.kind === 'OFFSTAGE');
    expect(g).toHaveLength(1);
    const x = Number(/set x ([\d.-]+)/.exec(g[0].hint)?.[1]);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(1920);
  });

  it('flags TINY_TEXT with limit about 38 and a fix that meets it', () => {
    const report = qaDoc(parse([text('a', { style: { fontSize: 20 } })]));
    const g = report.groups.find((x) => x.kind === 'TINY_TEXT');
    expect(g).toBeDefined();
    expect(g?.limit).toBeCloseTo(37.8, 0);
    expect(g?.hint).toMatch(/fontSize to (\d+)/);
    expect(Number(/fontSize to (\d+)/.exec(g?.hint ?? '')?.[1])).toBeGreaterThanOrEqual(38);
  });

  it('flags TEXT_OVERLAP once, naming both ids', () => {
    const report = qaDoc(parse([text('a'), text('b', { y: 540 + 64 * 0.7 })]));
    const g = report.groups.filter((x) => x.kind === 'TEXT_OVERLAP');
    expect(g).toHaveLength(1);
    expect(g[0].subject).toContain('a');
    expect(g[0].subject).toContain('b');
    expect(g[0].cause).toContain('"a"');
    expect(g[0].cause).toContain('"b"');
  });

  it('flags POP at the frame a set tween moves x by 900', () => {
    const doc = parse([text('a', { x: 500, tweens: [{ at: 2, duration: 0, to: { x: 1400 } }] })]);
    const pop = qaDoc(doc).groups.find((x) => x.kind === 'POP');
    expect(pop?.worstFrame).toBe(20);
    expect(pop?.hint).toContain('tweens[0]');
  });

  it('flags NEVER_SEEN for alpha 0, and warnings never change ok', () => {
    const report = qaDoc(parse([text('a'), text('hidden', { alpha: 0, y: 100 })]));
    expect(report.groups.map((g) => g.kind)).toEqual(['NEVER_SEEN']);
    const short = qaDoc(parse([text('a', { end: 1.4, text: 'one two three four five six seven' })]));
    for (const w of short.warnings) expect(['FAST_TEXT']).toContain(w.kind);
    expect(short.ok).toBe(short.groups.length === 0);
  });
});

describe('qaDoc 3D', () => {
  const three = (obj: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    id: 'stage',
    type: 'three',
    x: 960,
    y: 540,
    width: 800,
    height: 600,
    start: 0,
    end: 4,
    camera: { position: [0, 1, 6], lookAt: [0, 0.5, 0], fov: 35 },
    objects: [{ id: 'box', geometry: { type: 'box', size: [1, 1, 1] }, position: [0, 0.5, 0], ...obj }],
    ...extra,
  });
  const kinds = (layer: unknown) => qaDoc(parse([layer])).groups.filter((g) => !['NEVER_SEEN'].includes(g.kind));

  it('BELOW_FLOOR names the y to add', () => {
    const g = kinds(three({ position: [0, 0, 0] })).find((x) => x.kind === 'BELOW_FLOOR');
    expect(g?.hint).toContain('add 0.5');
    const g2 = kinds(three({ position: [0, -0.5, 0] })).find((x) => x.kind === 'BELOW_FLOOR');
    expect(g2?.hint).toContain('add 1 ');
  });

  it('FLOATING unless position.y is tweened', () => {
    expect(kinds(three({ position: [0, 1.5, 0] })).some((x) => x.kind === 'FLOATING')).toBe(true);
    const tw = { tweens: [{ target: 'object:box', at: 0, duration: 2, to: { 'position.y': 2 } }] };
    expect(kinds(three({ position: [0, 1.5, 0] }, tw)).some((x) => x.kind === 'FLOATING')).toBe(false);
  });

  it('a resting box is clean', () => {
    expect(kinds(three({}))).toEqual([]);
  });

  it('CAMERA_INSIDE and SUBJECT_OUT', () => {
    const inside = three({ geometry: { type: 'box', size: [2, 2, 2] }, position: [0, 1, 0] }, { camera: { position: [0, 0.5, 0], lookAt: [0, 0.5, -5], fov: 35 } });
    expect(kinds(inside).some((x) => x.kind === 'CAMERA_INSIDE')).toBe(true);
    const away = three({}, { camera: { position: [0, 1, 6], lookAt: [0, 1, 20], fov: 35 } });
    expect(kinds(away).some((x) => x.kind === 'SUBJECT_OUT')).toBe(true);
  });

  it('three-primitives.json has no 3D groups', () => {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'engine/fixtures/three-primitives.json'), 'utf8'));
    const result = parseMotionDoc(raw);
    if (!result.ok) throw new Error('bad fixture');
    const kinds3 = ['BELOW_FLOOR', 'FLOATING', 'CAMERA_INSIDE', 'SUBJECT_OUT'];
    expect(qaDoc(result.doc).groups.filter((g) => kinds3.includes(g.kind))).toEqual([]);
  });
});
