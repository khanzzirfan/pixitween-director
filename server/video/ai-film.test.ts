import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { setProductNoun } from '../authoring/meta';
import { towelFilm } from '../authoring/test-helpers';
import { aiFilmContext, aspectOf, chatNotes, buildAiFilmPrompt, buildH3Request, captureFrames, H3_ENDPOINT, H3_LIMITS, planAiFilm, quoteAiFilm } from './ai-film';

describe('planAiFilm', () => {
  it('sends one frame for about each 3 s of the clip, in timeline order, each from the scene playing then', () => {
    const plan = planAiFilm(towelFilm({ count: 2, sec: 5 }));
    expect(plan.durationSec).toBe(10);
    expect(plan.shots).toHaveLength(3);
    expect(plan.shots.map((s) => s.sceneId)).toEqual(['s1', 's2', 's2']);
    expect(plan.shots.every((s) => Math.abs(s.sec - 10 / 3) < 1e-9)).toBe(true);
    expect(plan.aspect).toBe('9:16');
  });

  it('draws each frame where the film is at that moment, not at one fixed point of the scene', () => {
    const plan = planAiFilm(towelFilm({ count: 1, sec: 9 }));
    const frames = plan.shots.map((s) => s.localFrame);
    expect(frames).toHaveLength(3);
    expect(frames).toEqual([...frames].sort((a, b) => a - b));
    expect(new Set(frames).size).toBe(frames.length);
  });

  it('lets a moment in a scene with no picture borrow the nearest scene that has one', () => {
    const plan = planAiFilm(towelFilm({ count: 2, sec: 3, bare: 1 }));
    expect(plan.shots.every((s) => ['s1', 's2'].includes(s.sceneId))).toBe(true);
    expect(plan.skipped).toEqual(['b1']);
  });

  it('caps the clip at 15 s however long the film is, and floors it at what the model allows', () => {
    expect(planAiFilm(towelFilm({ count: 3, sec: 3 })).durationSec).toBe(9);
    expect(planAiFilm(towelFilm({ count: 2, sec: 1 })).durationSec).toBe(H3_LIMITS.minSec);
    const long = planAiFilm(towelFilm({ count: 6, sec: 10 }));
    expect(long.filmSec).toBe(60);
    expect(long.durationSec).toBe(15);
    expect(long.shots).toHaveLength(5);
    expect(long.shots[0]!.sceneId).toBe('s1');
    expect(long.shots.at(-1)!.sceneId).toBe('s6');
  });

  it('plans nothing for a film with no pictures', () => {
    expect(planAiFilm(towelFilm({ count: 0, bare: 2 })).shots).toEqual([]);
  });
});

describe('quoteAiFilm', () => {
  it('prices the clip by its length at the chosen resolution', () => {
    const plan = planAiFilm(towelFilm({ count: 2, sec: 5 }));
    expect(quoteAiFilm(plan, '480P')).toMatchObject({ durationSec: 10, costUsd: 0.5, frames: 3, resolution: '480P' });
    expect(quoteAiFilm(plan, '768P').costUsd).toBe(0.8);
  });
});

describe('chatNotes', () => {
  it('keeps what the director asked for and the film in one line, and drops status chatter', () => {
    const notes = chatNotes([
      { type: 'showrunner.say', kind: 'note', text: 'Film in one line: berries drop in.' },
      { type: 'showrunner.say', kind: 'note', text: 'Crew is building all five shots now.' },
      { type: 'showrunner.heard', from: 'user', text: 'make the cup bigger\n in shot 2' },
      { type: 'showrunner.heard', from: 'crew', text: 'job done' },
    ]);
    expect(notes).toBe('Film in one line: berries drop in. Director: make the cup bigger in shot 2');
  });
});

describe('aiFilmContext', () => {
  const film = {
    title: 'Berrybloom',
    brief: { text: 'A 10 second film for Berrybloom yoghurt.\r\n\r\nLight: soft key.\r\n\r\nShot 1, hook (0-2s): a swirl.\r\n\r\nPacing: fast.', transcript: 'user: keep it high-key', productAssetId: 'a' },
    styleBible: { mood: 'Glossy, fresh', light: 'Soft key', productLine: 'Berrybloom cup, sole hero' },
    storyboard: { scenes: [{ id: 's1', intent: 'Hook: the cup drops in.', beats: 'Cup drops from top, overshoots 20px; berries splash at 0.4s; mint passes the lens.' }] },
  } as never;

  it('keeps the brief up to its shot list, the chat, the look and each scene\'s own intent', () => {
    const ctx = aiFilmContext(film);
    expect(ctx.brief).toBe('A 10 second film for Berrybloom yoghurt. Light: soft key.');
    expect(ctx.transcript).toBe('user: keep it high-key');
    expect(ctx.style).toMatchObject({ mood: 'Glossy, fresh', productLine: 'Berrybloom cup, sole hero' });
    expect(ctx.intents).toEqual({ s1: 'Hook: the cup drops in.' });
    expect(ctx.props).toEqual({ s1: 'Cup drops from top, overshoots 20px; mint passes the lens' });
    expect(ctx.productName).toBe(undefined);
  });

  it('reaches the prompt: product, look, brief, chat and the storyboard intent for the shot', () => {
    const prompt = buildAiFilmPrompt(planAiFilm(setProductNoun(towelFilm({ count: 1, sec: 5 }), 'yoghurt cup'), { ...aiFilmContext(film), intents: { s1: 'Hook: the cup drops in.' } }));
    expect(prompt).toContain('Subject: a yoghurt cup.');
    expect(prompt).toContain('Hero: Berrybloom cup, sole hero.');
    expect(prompt).toContain('Look: Glossy, fresh; Soft key.');
    expect(prompt).toContain('Brief: A 10 second film for Berrybloom yoghurt.');
    expect(prompt).toContain('Notes from the chat with the director: user: keep it high-key');
    expect(prompt).toContain('Image 1: Hook: the cup drops in. Elements: Cup drops from top, overshoots 20px; mint passes the lens');
  });
});

describe('buildAiFilmPrompt', () => {
  const prompt = buildAiFilmPrompt(planAiFilm(setProductNoun(towelFilm({ count: 2, sec: 5 }), 'beach towel'), { productName: 'Dunebloom' }));

  it('names the product and lists a shot per ~3 s in order, each tied to its picture, ending exactly at the clip length', () => {
    expect(prompt).toContain('Subject: Dunebloom, a beach towel.');
    expect(prompt).toContain('3 reference images in time order, one per 3.3 seconds');
    expect(prompt).toContain('Shot 1 (0.0s-3.3s), Image 1: Shot 1 of the towel. Camera:');
    expect(prompt).toContain('Shot 3 (6.7s-10.0s), Image 3:');
  });

  it('locks the product and forbids text', () => {
    expect(prompt).toContain('keeps the exact shape, colours, pattern and label');
    expect(prompt).toContain('No on-screen text, no captions, no subtitles, no logos, no watermark');
  });

  it('drops the chat and then the brief before the shot list when the prompt runs long', () => {
    const long = planAiFilm(towelFilm({ count: 6, sec: 10 }), { brief: 'b'.repeat(2000), transcript: 't'.repeat(2000), style: { mood: 'm'.repeat(300), light: 'l'.repeat(300), productLine: 'p'.repeat(300) }, props: Object.fromEntries(['s1', 's2', 's3', 's4', 's5', 's6'].map((id) => [id, 'x'.repeat(400)])) });
    const p = buildAiFilmPrompt(long);
    expect(p.length).toBeLessThan(3700);
    expect(p).toContain('Image 5:');
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
    const plan = planAiFilm(comp);
    const frames = await captureFrames({ assets: { read: async () => photo } as never }, comp, plan);
    expect(frames).toHaveLength(plan.shots.length);
    for (const f of frames) {
      const meta = await sharp(f).metadata();
      expect(meta.format).toBe('jpeg');
      expect([meta.width, meta.height]).toEqual([720, 1280]);
    }
  });
});
