import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHARACTER_SRC, ROBOT_CLIPS, resolveClip } from './characters';

describe('the toy character', () => {
  it('is a file the web app serves', () => {
    expect(existsSync(new URL(`../../web/public${CHARACTER_SRC}`, import.meta.url))).toBe(true);
  });

  it.each([
    ['Walk', 'Walk'],
    ['shuffle out', 'Walk'],
    ['leap for joy', 'Jump'],
    ['wave hello', 'Wave'],
    ['drink the cold brew', 'ThumbsUp'],
    ['celebrate', 'Dance'],
    ['wake up', 'Stand'],
    ['unknowable', 'Idle'],
  ])('%s is the %s clip', (name, clip) => {
    expect(resolveClip(name)).toBe(clip);
    expect(ROBOT_CLIPS).toContain(clip);
  });
});
