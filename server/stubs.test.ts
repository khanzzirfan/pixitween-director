import { describe, expect, it } from 'vitest';

const modules: Array<[string, string]> = [
  ['./authoring/api', 'S3a'],
  ['./agent/director', 'S3b'],
  ['./agent/storyboard', 'S3b'],
  ['./agent/build-scene', 'S3b'],
  ['./agent/prompts/director', 'S3b'],
  ['./listener', 'S3b'],
  ['./art/cutout', 'S4'],
  ['./art/stills', 'S4'],
  ['./review/rules', 'S5a'],
  ['./review/visual', 'S5b'],
  ['./agent/edit-loop', 'S6'],
  ['./http/handlers/films', 'S3b'],
  ['./http/handlers/chat', 'S6'],
  ['./http/handlers/review', 'S5b'],
];

describe('step modules expose their owner', () => {
  it.each(modules)('%s is owned by %s', async (path, owner) => {
    const module = (await import(/* @vite-ignore */ path)) as { STUB_OWNER?: string };
    expect(module.STUB_OWNER).toBe(owner);
  });
});
