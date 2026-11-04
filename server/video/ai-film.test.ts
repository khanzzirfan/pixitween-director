import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { setProductNoun } from '../authoring/meta';
import { towelFilm } from '../authoring/test-helpers';
import { aspectOf, buildAiFilmPrompt, buildH3Request, captureFrames, H3_ENDPOINT, H3_LIMITS, planAiFilm, quoteAiFilm } from './ai-film';

describe('planAiFilm', () => {
  it('makes one shot per scene that has pictures, in timeline order, and skips the rest', () => {
    const plan = planAiFilm(towelFilm({ count: 2, bare: 1 }));
    expect(plan.shots.map((s) => s.sceneId)).toEqual(['s1', 's2']);
    expect(plan.skipped).toEqual(['b1']);
    expect(plan.aspect).toBe('9:16');
  });

  it('gives the clip the film length, held to what the model allows', () => {
    expect(planAiFilm(towelFilm({ count: 3, sec: 3 })).durationSec).toBe(9);
    expect(planAiFilm(towelFilm({ count: 2, sec: 1 })).durationSec).toBe(H3_LIMITS.minSec);
    const long = planAiFilm(towelFilm({ count: 6, sec: 5 }));
    expect(long.filmSec).toBe(30);
    expect(long.durationSec).toBe(H3_LIMITS.maxSec);
  });

  it('splits the clip across the shots in proportion to their scenes', () => {
    const plan = planAiFilm(towelFilm({ count: 3, sec: 3 }));
    expect(plan.shots.map((s) => s.sec)).toEqual([3, 3, 3]);
  });

  it('keeps the first and last scene when there are more scenes than frames the model takes', () => {
    const plan = planAiFilm(towelFilm({ count: 6, sec: 2 }));
    expect(plan.shots).toHaveLength(H3_LIMITS.maxFrames);
    expect(plan.shots[0]!.sceneId).toBe('s1');
    expect(plan.shots.at(-1)!.sceneId).toBe('s6');
    expect(plan.shots.reduce((n, s) => n + s.sec, 0)).toBeCloseTo(plan.durationSec, 0);
  });

  it('plans nothing for a film with no pictures', () => {
    expect(planAiFilm(towelFilm({ count: 0, bare: 2 })).shots).toEqual([]);
  });
});

describe('quoteAiFilm', () => {
  it('prices the clip by its length at the chosen resolution', () => {
    const plan = planAiFilm(towelFilm({ count: 2, sec: 5 }));
    expect(quoteAiFilm(plan, '480P')).toMatchObject({ durationSec: 10, costUsd: 0.5, frames: 2, resolution: '480P' });
    expect(quoteAiFilm(plan, '768P').costUsd).toBe(0.8);
  });
});

describe('buildAiFilmPrompt', () => {
  const prompt = buildAiFilmPrompt(planAiFilm(setProductNoun(towelFilm({ count: 2, sec: 3 }), 'beach towel')));

  it('lists the shots in order, each tied to its picture, ending exactly at the clip length', () => {
    expect(prompt).toContain('Shot 1 (0.0s-3.0s), Image 1: Shot 1 of the towel. Camera:');
    expect(prompt).toContain('Shot 2 (3.0s-6.0s), Image 2:');
  });

  it('locks the product and forbids text', () => {
    expect(prompt).toContain('The product is a beach towel.');
    expect(prompt).toContain('keeps the exact shape, colours, pattern and label');
    expect(prompt).toContain('No on-screen text, no captions, no subtitles, no logos, no watermark');
  });

  it('stays well inside a prompt length a model will take', () => {
    expect(buildAiFilmPrompt(planAiFilm(towelFilm({ count: 6, sec: 2 }))).length).toBeLessThan(1500);
  });
});

describe('buildH3Request', () => {
  it('is the reference-to-video input Fal documents', () => {
    const plan = planAiFilm(towelFilm({ count: 2, sec: 3 }));
    const req = buildH3Request(plan, ['https://v3.fal.media/a.jpg', 'https://v3.fal.media/b.jpg'], '480P');
    expect(req.model).toBe(H3_ENDPOINT);
    expect(req.input).toMatchObject({ duration: 6, resolution: '480P', aspect_ratio: '9:16', prompt_expansion_mode: 'disabled', reference_image_urls: ['https://v3.fal.media/a.jpg', 'https://v3.fal.media/b.jpg'] });
  });
});

describe('aspectOf', () => {
  it('reads the frame shape', () => {
    expect([aspectOf(1080, 1920), aspectOf(1920, 1080), aspectOf(1080, 1080)]).toEqual(['9:16', '16:9', '1:1']);
  });
});

describe('captureFrames', () => {
  it('draws one JPEG per shot, in the film shape, with no text in it', async () => {
    const comp = towelFilm({ count: 2 });
    const photo = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#2a6f97' } }).png().toBuffer();
    const frames = await captureFrames({ assets: { read: async () => photo } as never }, comp, planAiFilm(comp));
    expect(frames).toHaveLength(2);
    for (const f of frames) {
      const meta = await sharp(f).metadata();
      expect(meta.format).toBe('jpeg');
      expect([meta.width, meta.height]).toEqual([864, 1536]);
    }
  });
});
