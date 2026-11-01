import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLATE_GRID } from '@engine/qa';
import { PLATE_READ_JSON_SCHEMA, platePixels, plateReadPrompt, readPlate, snapY } from './plate-map';

// The tabletop plate: a wooden table whose back edge meets the wall about 63% down and whose front edge is about 85% down.
const TABLETOP = readFileSync('data/assets/ast_04d50dc418756070b185948227520d4f.jpg');

describe('platePixels', () => {
  it('measures a 12x12 busy grid and finds the table edges', async () => {
    const px = await platePixels(TABLETOP);
    expect(px.busy).toHaveLength(PLATE_GRID * PLATE_GRID);
    expect(px.busy.every((b) => b >= 0 && b <= 1)).toBe(true);
    const ys = px.edges.map((e) => e.y);
    expect(ys.some((y) => Math.abs(y - 0.634) < 0.01), 'back edge').toBe(true);
    expect(ys.some((y) => Math.abs(y - 0.85) < 0.01), 'front edge').toBe(true);
  });
});

describe('snapY', () => {
  const edges = [{ y: 0.634, strength: 56 }, { y: 0.85, strength: 100 }];
  it('snaps a rough y to the nearest measured edge within reach, and to the frame bottom', () => {
    expect(snapY(0.6, edges)).toBe(0.634);
    expect(snapY(0.87, edges)).toBe(0.85);
    expect(snapY(0.98, edges)).toBe(1);
  });
  it('keeps the rough y when no edge is near', () => {
    expect(snapY(0.4, edges)).toBe(0.4);
  });
});

describe('readPlate', () => {
  it('takes the surfaces and quadrants from the model and snaps them to the measured edges', async () => {
    const prompts: string[] = [];
    const fake = async (_images: unknown[], prompt: string) => {
      prompts.push(prompt);
      return {
        quadrants: { Q1: 'plain wall, calm', Q2: 'window and plant, busy', Q3: 'table with figs', Q4: 'table, calm' },
        surfaces: [
          { name: 'table top', top: 0.61, bottom: 0.87, left: 0, right: 1 },
          { name: 'sliver', top: 0.3, bottom: 0.305, left: 0.1, right: 0.2 },
        ],
      };
    };
    const map = await readPlate(TABLETOP, fake);
    expect(map.source).toBe('vision');
    expect(map.surfaces).toEqual([{ name: 'table top', top: 0.634, bottom: 0.85, left: 0, right: 1 }]);
    expect(map.quadrants?.Q2).toMatch(/busy/);
    expect(prompts[0]).toMatch(/Q1 is the top-right/);
  });

  it('leaves the plate unread, with no surfaces, when there is no model or it fails', async () => {
    expect((await readPlate(TABLETOP)).surfaces).toEqual([]);
    const broken = await readPlate(TABLETOP, async () => {
      throw new Error('down');
    });
    expect(broken).toMatchObject({ source: 'pixels', surfaces: [], error: 'down' });
    const junk = await readPlate(TABLETOP, async () => ({ surfaces: 'none' }));
    expect(junk.source).toBe('pixels');
    expect(junk.error).toMatch(/schema/);
  });

  it('sends a schema strict mode accepts: every object closed, every property required', () => {
    const walk = (o: any): void => {
      if (o?.type === 'object') {
        expect(o.additionalProperties).toBe(false);
        expect([...o.required].sort()).toEqual(Object.keys(o.properties).sort());
        Object.values(o.properties).forEach(walk);
      }
      if (o?.type === 'array') walk(o.items);
    };
    walk(PLATE_READ_JSON_SCHEMA);
  });

  it('puts the measured edges in the prompt', async () => {
    expect(plateReadPrompt(await platePixels(TABLETOP))).toMatch(/0\.634/);
  });
});
