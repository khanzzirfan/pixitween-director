import type { Comp } from './types';

// What the vision critic is asked about a retail clip, built from the clip's own JSON (meta.layout) and the plate's read, so
// the questions name the real surface and the real busy quadrants. It judges what code cannot measure from boxes: whether the
// pack looks grounded (a soft contact shadow, light on the right side), whether type reads on the plate, whether the price
// reads inside its ring. The measured rules (qaPlacement, qaLayout) stay with the verifier.

interface PlateNote {
  surface?: string;
  quadrants?: Partial<Record<'Q1' | 'Q2' | 'Q3' | 'Q4', string>>;
}

/** The plate note a retail clip carries, or undefined when the comp is not a retail clip. */
export function retailPlateNote(comp: Comp): { plate?: PlateNote } | undefined {
  const layout = (comp.meta as { layout?: { grounded?: string[]; plate?: PlateNote } } | undefined)?.layout;
  return layout?.grounded?.length ? { ...(layout.plate ? { plate: layout.plate } : {}) } : undefined;
}

/** Questions where a yes is a fault. Empty for a comp that is not a retail clip. */
export function retailFaultQuestions(comp: Comp): string[] {
  const note = retailPlateNote(comp);
  if (!note) return [];
  const { surface, quadrants } = note.plate ?? {};
  const busy = Object.entries(quadrants ?? {}).filter(([, v]) => /busy/i.test(v ?? '')).map(([q, v]) => `${q} (${v})`);
  return [
    `Does the product look like it floats, because there is no soft dark contact shadow where its base meets ${surface ? `the ${surface}` : 'the surface'}?`,
    `Is the product's base off ${surface ? `the ${surface}` : 'the surface it should stand on'}, standing against the wall or hanging past the front edge?`,
    `Is any text or price hard to read because it sits on a busy part of the background${busy.length ? `, such as ${busy.join('; ')}` : ''}?`,
    'Are the price digits cut off, or do they cross the edge of the circle or pill around them?',
  ];
}
