import { expect, it } from 'vitest';
import { readSeedJson } from '../server/test-utils/fixtures';
import { storyboardSchema, type Storyboard } from './storyboard';

function seedStoryboard(): Storyboard {
  const content = JSON.parse(readSeedJson('spark-storyboard-response.json').choices[0].message.content);
  return {
    title: content.title,
    aspect: '16:9',
    durationSec: 12,
    palette: ['#1a1a1a'],
    scenes: content.scenes.map((s: object) => ({ ...s, shotType: 'hero', camera: 'static', layersWanted: ['bg', 'product'] })),
  };
}

it('accepts the seed storyboard and keeps the pour scene in generate mode', () => {
  const r = storyboardSchema.safeParse(seedStoryboard());
  expect(r.success).toBe(true);
  expect(r.success && r.data.scenes.find((s) => s.id.includes('pour'))?.mode).toBe('generate');
});

it('rejects a 12 s scene with a durationSec path', () => {
  const sb = seedStoryboard();
  sb.scenes[0]!.durationSec = 12;
  const r = storyboardSchema.safeParse(sb);
  expect(r.success).toBe(false);
  expect(!r.success && r.error.issues.some((i) => i.path.at(-1) === 'durationSec')).toBe(true);
});

it('rejects duplicate scene ids, naming the id', () => {
  const sb = seedStoryboard();
  sb.scenes[1]!.id = sb.scenes[0]!.id;
  const r = storyboardSchema.safeParse(sb);
  expect(!r.success && r.error.issues.some((i) => i.message.includes(sb.scenes[0]!.id))).toBe(true);
});

it('rejects a total over 30 s', () => {
  const sb = seedStoryboard();
  sb.scenes = Array.from({ length: 5 }, (_, i) => ({ ...sb.scenes[0]!, id: `s${i}`, durationSec: 6.2 }));
  expect(storyboardSchema.safeParse(sb).success).toBe(false);
});

it('rejects a scene id with a colon', () => {
  const sb = seedStoryboard();
  sb.scenes[0]!.id = 'scene:1';
  expect(storyboardSchema.safeParse(sb).success).toBe(false);
});
