import { describe, expect, it } from 'vitest';
import { boardPrompt } from './beatsheet';
import { ideaLines, parsePitch, pitchPrompt, PITCH_COUNT, type Idea } from './pitch';

const idea = (name: string): Idea => ({ name, world: `${name} world`, mood: 'calm', light: 'soft window light', colour: 'cream and sage', camera: 'slow push', elements: 'linen threads drift', ending: 'rests on the price' });

describe('pitchPrompt', () => {
  const p = pitchPrompt({ title: 'Pure Spoonful', brief: 'a 10 s yoghurt ad', seconds: 10 });
  it('asks for different ideas and a pick, and names what the film can show', () => {
    expect(p).toContain(`pitch ${PITCH_COUNT} film ideas`);
    expect(p).toMatch(/Not 3 versions of one idea/);
    expect(p).toContain('"pick"');
    for (const w of ['beach', 'sunset', 'orbit', 'ripple', 'It cannot show people']) expect(p).toContain(w);
  });
  it('orders no look, mood or colour', () => {
    expect(p).not.toMatch(/dark, moody|teal|classic/i);
  });
  it('keeps the brief and the product', () => {
    expect(p).toContain('a 10 s yoghurt ad');
    expect(p).toContain('Product: Pure Spoonful.');
  });
});

describe('parsePitch', () => {
  it('reads three ideas and Muse\'s pick', () => {
    const r = parsePitch({ ideas: [idea('A'), idea('B'), idea('C')], pick: 2, why: 'B sells it' });
    expect(r?.ideas).toHaveLength(3);
    expect(r?.chosen.name).toBe('B');
    expect(r?.why).toBe('B sells it');
  });
  it('reads a JSON string', () => {
    expect(parsePitch(JSON.stringify({ ideas: [idea('A')], pick: 1, why: '' }))?.chosen.name).toBe('A');
  });
  it('falls back to the first idea when the pick is out of range or missing', () => {
    expect(parsePitch({ ideas: [idea('A'), idea('B')], pick: 7, why: '' })?.chosen.name).toBe('A');
    expect(parsePitch({ ideas: [idea('A'), idea('B')], why: '' })?.chosen.name).toBe('A');
  });
  it('gives nothing for a reply with no usable idea', () => {
    expect(parsePitch({ pass: true, issues: [] })).toBeUndefined();
    expect(parsePitch({ ideas: [{ name: '', world: '' }], pick: 1 })).toBeUndefined();
    expect(parsePitch('not json')).toBeUndefined();
  });
  it('cuts over-long fields instead of refusing them', () => {
    const r = parsePitch({ ideas: [{ ...idea('A'), world: 'x'.repeat(400) }], pick: 1, why: '' });
    expect(r?.chosen.world.length).toBe(240);
  });
});

describe('the board prompt with an idea', () => {
  it('carries the chosen idea into the user part', () => {
    const { user } = boardPrompt({ title: 'Towel', seconds: 8, idea: idea('Morning linen') });
    for (const line of ideaLines(idea('Morning linen'))) expect(user).toContain(line);
  });
  it('is unchanged without one', () => {
    expect(boardPrompt({ title: 'Towel', seconds: 8 }).user).not.toContain('THE IDEA');
  });
});
