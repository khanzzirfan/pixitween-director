import { beforeEach, describe, expect, it } from 'vitest';
import { clearText3DStats, getText3DStats, recordText3DStats } from './debug';

describe('text3d debug stats', () => {
  beforeEach(() => clearText3DStats());

  it('keeps the latest stats per object id', () => {
    recordText3DStats('a', { glyphCount: 1, uniqueGeometries: 1, triangles: 10, buildMs: 1 });
    recordText3DStats('a', { glyphCount: 2, uniqueGeometries: 2, triangles: 20, buildMs: 2 });
    expect(getText3DStats()).toEqual({ a: { glyphCount: 2, uniqueGeometries: 2, triangles: 20, buildMs: 2 } });
  });

  it('clears', () => {
    recordText3DStats('a', { glyphCount: 1, uniqueGeometries: 1, triangles: 1, buildMs: 0 });
    clearText3DStats();
    expect(getText3DStats()).toEqual({});
  });
});
