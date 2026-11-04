import { describe, expect, it } from 'vitest';
import { ELEMENT_BODY, PRODUCT_BODY, productBody } from './forms';

describe('productBody', () => {
  it('turns a form into the numbers the body is swept with', () => {
    expect(productBody('round')).toEqual({ form: 'round', depth: 0.95, section: 2 });
    expect(productBody('boxy')).toEqual({ form: 'boxy', depth: 0.6, section: 4.5 });
    expect(productBody('slab')).toEqual({ form: 'slab', depth: 0.25, section: 5 });
    expect(productBody('lying')).toEqual({ form: 'lying', depth: 0.95, section: 2, axis: 'across' });
  });
  it("keeps Muse's depth inside the form's range, so a round tub is never built as a thin card", () => {
    expect(productBody('round', 0.3).depth).toBe(PRODUCT_BODY.round.range[0]);
    expect(productBody('round', 0.85).depth).toBe(0.85);
    expect(productBody('slab', 0.9).depth).toBe(PRODUCT_BODY.slab.range[1]);
  });
  it('makes a round element as deep as it is wide and a thin one a sliver', () => {
    expect(ELEMENT_BODY.round).toEqual({ depth: 0.9, section: 2 });
    expect(ELEMENT_BODY.thin.depth).toBeLessThan(0.15);
  });
});
