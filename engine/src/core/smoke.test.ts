import { describe, expect, it } from 'vitest';
import { gsap } from 'gsap';
import * as three from 'three';
import { MOTION_SCHEMA_VERSION } from '@engine/core/version';

describe('engine scaffold', () => {
  it('resolves imports through the @engine alias', () => {
    expect(MOTION_SCHEMA_VERSION).toBe(1);
  });

  it('imports the engine runtime dependencies', () => {
    expect(typeof gsap.timeline).toBe('function');
    expect(typeof three.Scene).toBe('function');
  });
});
