import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { buildMuxArgs, collectAudio, gainExpr, levelToGain, muxAudio } from './audio';

const audioLayer = (o: Record<string, unknown> = {}) => ({ kind: 'audio', id: 'music', assetId: 'a1', inPoint: 0, outPoint: 300, level: 0.7, ...o });
const comp = (layers: unknown[], extra: Record<string, unknown> = {}) => ({ fps: 30, assets: { a1: { type: 'audio', src: '/api/assets/ast_0123abcd' } }, layers, ...extra });

it('collects audio layers, through precomps, in start order', () => {
  const c = comp([{ kind: 'precomp', compId: 'p', inPoint: 60, outPoint: 120 }, audioLayer()], {
    precomps: { p: { fps: 30, assets: {}, layers: [audioLayer({ id: 'sting', inPoint: 30, outPoint: 90, level: 1 })] } },
  });
  expect(collectAudio(c).map((i) => [i.layerId, i.startSec, i.endSec])).toEqual([['music', 0, 10], ['sting', 3, 5]]);
});
it('skips hidden layers and assets that are not stored', () => {
  expect(collectAudio(comp([audioLayer({ hidden: true }), audioLayer({ id: 'x', assetId: 'nope' })]))).toEqual([]);
  expect(collectAudio({ ...comp([audioLayer()]), assets: { a1: { src: 'https://x/y.wav' } } })).toEqual([]);
});
it('turns levels into gain points', () => {
  expect(levelToGain(0.7, 30, 0)).toEqual([[0, 0.7]]);
  expect(levelToGain(undefined, 30, 0)).toEqual([[0, 1]]);
  expect(levelToGain([{ t: 0, v: 0 }, { t: 30, v: 1 }], 30, 0)).toEqual([[0, 0], [1, 1]]);
});
it('writes a volume expression that follows the points', () => {
  expect(gainExpr([[0, 0.7]])).toBe('0.7');
  expect(gainExpr([[0, 0], [1, 1]])).toBe('if(lt(t,0),0,if(lt(t,1),0+(1)*(t-0)/1,1))');
});
it('builds one chain per item, mixes without normalising and keeps the picture', () => {
  const args = buildMuxArgs({ video: 'v.mp4', files: ['a.bin', 'b.bin'], durationSec: 10, out: 'o.mp4', items: [
    { layerId: 'm', assetId: 'a', startSec: 0, endSec: 10, gain: [[0, 0.7]] },
    { layerId: 's', assetId: 'b', startSec: 3, endSec: 5, gain: [[0, 1]], pan: -1 },
  ] });
  const graph = args[args.indexOf('-filter_complex') + 1]!;
  expect(graph).toContain("[1:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=0:10,asetpts=PTS-STARTPTS,volume='0.7':eval=frame,adelay=0|0[a0]");
  expect(graph).toContain('atrim=0:2');
  expect(graph).toContain('adelay=3000|3000[a1]');
  expect(graph).toContain('pan=stereo|c0=1*c0|c1=0*c1');
  expect(graph).toContain('amix=inputs=2:normalize=0');
  expect(args).toEqual(expect.arrayContaining(['-c:v', 'copy', '-c:a', 'aac', '-t', '10']));
});
it('mixes what it can read and names what it cannot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mux-'));
  try {
    const run = vi.fn().mockResolvedValue({ stdout: Buffer.alloc(0), stderr: '' });
    const read = vi.fn(async (id: string) => { if (id === 'bad') throw new Error('gone'); return Buffer.from('wav'); });
    const item = (assetId: string, layerId: string) => ({ layerId, assetId, startSec: 0, endSec: 5, gain: [[0, 1]] as [number, number][] });
    const r = await muxAudio({ dir, video: 'v', out: 'o', durationSec: 5, items: [item('ok', 'm'), item('bad', 's')], read }, run);
    expect(r.skipped).toEqual(['s']);
    expect(run).toHaveBeenCalledTimes(1);
    await expect(muxAudio({ dir, video: 'v', out: 'o', durationSec: 5, items: [item('bad', 's')], read }, run)).rejects.toThrow('no audio could be read');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
