import { describe, expect, it } from 'vitest';
import { clearFixes, findFix, MAX_RECORDS_PER_FILM, recordFixes } from './fix-log';

describe('fix log', () => {
  it('pairs a fix with an after frame once', () => {
    clearFixes('f');
    recordFixes('f', [{ sceneId: 's1', atSec: 1, note: 'n', beforeFrame: 'b' }]);
    expect(findFix('f', 's1', 1)?.beforeFrame).toBe('b');
    expect(findFix('f', 's1', 1)).toBeUndefined();
  });

  it('keeps only the newest records per film and forgets a cleared film', () => {
    clearFixes('g');
    recordFixes('g', Array.from({ length: MAX_RECORDS_PER_FILM + 20 }, (_, i) => ({ sceneId: 's1', atSec: i, note: `n${i}` })));
    expect(findFix('g', 's1', 0)).toBeUndefined();
    expect(findFix('g', 's1', MAX_RECORDS_PER_FILM + 19)?.note).toBe(`n${MAX_RECORDS_PER_FILM + 19}`);
    clearFixes('g');
    expect(findFix('g', 's1', MAX_RECORDS_PER_FILM + 19)).toBeUndefined();
  });
});
