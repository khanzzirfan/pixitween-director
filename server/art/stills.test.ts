import { describe, expect, it } from 'vitest';
import { lintPrompt } from './lint';
import { subjectPrompt } from './stills';

describe('subjectPrompt', () => {
  it('passes the subject lint with its own safety wording', () => {
    const result = lintPrompt(subjectPrompt('A barista in a green apron holding a coffee mug'), { subject: true });
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
