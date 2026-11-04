import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@shared/tools';
import { defaultBeatSheet, planBoard, type CinematicBoard } from '../../authoring/beatsheet';
import { floorElements } from '../../authoring/ingredients';
import { commitCuts } from '../form-pick';
import { prepareCinematicParts } from '../cinematic-cut';
import { checkSheets } from './check';
import { lookAtFilm } from './film-sheet';

vi.mock('../../authoring/beatsheet', async (orig) => ({ ...(await orig<Record<string, unknown>>()), planBoard: vi.fn() }));
vi.mock('../cinematic-cut', () => ({ prepareCinematicParts: vi.fn(), buildCinematic: vi.fn(() => ({ durationInFrames: 240, fps: 30 })), pricesIn: vi.fn(() => undefined) }));
vi.mock('../form-pick', () => ({ commitCuts: vi.fn(async () => true) }));
vi.mock('../frame-review', () => ({ renderKeyFrames: vi.fn() }));
vi.mock('./render', () => ({ drawSheets: vi.fn(async () => ({ product: Buffer.from('p'), set: Buffer.from('s'), assetIds: [], skipped: [] })) }));
vi.mock('./check', () => ({ checkSheets: vi.fn() }));
vi.mock('./film-sheet', () => ({ lookAtFilm: vi.fn() }));
vi.mock('./json-rules', () => ({ jsonRules: vi.fn(() => []) }));

const { makeSheetFilm } = await import('./index');

const elements = floorElements('Pure Spoonful Berry Yoghurt', 'food');
const board: CinematicBoard = { concept: 'berries', mood: 'fresh', elements, sheet: defaultBeatSheet(elements) };

function setup() {
  const update = vi.fn(async () => undefined);
  const emit = vi.fn();
  const ctx = {
    filmId: 'film_aaaaaaaaaaaa',
    films: { get: vi.fn(async () => ({ id: 'film_aaaaaaaaaaaa', aspect: '9:16', brief: { text: 'Cinematic 10s vertical (9:16) yoghurt ad', productAssetId: 'ast_p' }, assets: [{ id: 'ast_p', role: 'product-photo' }] })), update },
    assets: { read: vi.fn(async () => Buffer.from('photo')) },
    emit,
  } as unknown as ToolCtx;
  return { ctx, update, emit };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prepareCinematicParts).mockResolvedValue({ title: 'Pure Spoonful', aspect: '9:16', board, prep: { shape: 'other' } } as never);
  vi.mocked(checkSheets).mockResolvedValue({ fine: true, problems: [], dropElements: [] });
  vi.mocked(lookAtFilm).mockImplementation(async (_c, o) => ({ board: o.board, film: o.build(o.board), sheet: Buffer.from('x'), revised: false, problems: [] }));
});

describe('makeSheetFilm', () => {
  it('commits one solid film with no flat cut and writes the storyboard', async () => {
    const { ctx, update, emit } = setup();
    let clock = 0;
    const r = await makeSheetFilm(ctx, { log: vi.fn(), render: vi.fn(), now: () => (clock += 1000) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.seconds)).toEqual(expect.arrayContaining(['parts', 'sheets', 'check', 'look', 'commit']));
    expect(commitCuts).toHaveBeenCalledTimes(1);
    const cuts = vi.mocked(commitCuts).mock.calls[0]![2];
    expect(cuts.flat).toBeUndefined();
    expect(cuts.keep).toBe('3d');
    expect(prepareCinematicParts).toHaveBeenCalledWith(ctx, expect.any(Function), { seconds: 10 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'director.storyboard' }));
    expect(planBoard).not.toHaveBeenCalled();
  });
  it('fails with a plain reason when the parts cannot be made', async () => {
    vi.mocked(prepareCinematicParts).mockResolvedValue(undefined);
    const r = await makeSheetFilm(setup().ctx, { log: vi.fn(), render: vi.fn() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/photo|cut out/);
    expect(commitCuts).not.toHaveBeenCalled();
  });
  it('makes no board call of its own for sheet problems: it hands them to the one revision after the film sheet', async () => {
    vi.mocked(checkSheets).mockResolvedValue({ fine: false, problems: ['the tub is brown'], dropElements: [] });
    const r = await makeSheetFilm(setup().ctx, { log: vi.fn(), render: vi.fn() });
    expect(r.ok).toBe(true);
    expect(planBoard).not.toHaveBeenCalled();
    expect(vi.mocked(lookAtFilm).mock.calls[0]![1].fromSheets).toEqual(['the tub is brown']);
    // a flat cut-out product is told so on the revision
    expect(vi.mocked(lookAtFilm).mock.calls[0]![1].flat).toBe(true);
  });
  it('still drops an element Muse names on the sheets before the film is built', async () => {
    vi.mocked(checkSheets).mockResolvedValue({ fine: false, problems: [], dropElements: [elements[0]!.id] });
    await makeSheetFilm(setup().ctx, { log: vi.fn(), render: vi.fn() });
    const ids = vi.mocked(lookAtFilm).mock.calls[0]![1].board.elements.map((e) => e.id);
    if (elements.length > 1) expect(ids).not.toContain(elements[0]!.id);
  });
  it('fails when the film check refuses the film', async () => {
    vi.mocked(commitCuts).mockResolvedValueOnce(false);
    const r = await makeSheetFilm(setup().ctx, { log: vi.fn(), render: vi.fn() });
    expect(r).toEqual({ ok: false, reason: 'the film check refused the 3D film' });
  });
});
