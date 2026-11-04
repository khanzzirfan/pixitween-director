// The idea step of a 3D film: before any shot list, Muse looks at the product photo, pitches three films as different as three directors would
// make, and picks one. The board is then written from the chosen idea (boardPrompt's `idea`). Every creative choice here is Muse's; the code
// only says what the film can show, so the ideas are ones the builder can make. A failed or unreadable pitch is not an error: the board is
// written without an idea, as before.
import type { Buffer } from 'node:buffer';
import { z } from 'zod';
import type { ToolCtx } from '@shared/tools';
import { BOARD_TEMPERATURE } from './beatsheet';
import { VOCAB } from './cinematic-rules';
import { SET_AIR, SET_LOOKS } from './set-art';

/** One pitched film, in Muse's words. */
export interface Idea {
  name: string;
  world: string;
  mood: string;
  light: string;
  colour: string;
  camera: string;
  elements: string;
  ending: string;
}

export interface Pitch {
  ideas: Idea[];
  chosen: Idea;
  why: string;
}

export const PITCH_COUNT = 3;

const text = (max: number) => z.string().trim().max(max * 2).transform((s) => s.slice(0, max)).catch('');
const ideaSchema = z.object({
  name: text(60),
  world: text(240),
  mood: text(120),
  light: text(200),
  colour: text(200),
  camera: text(300),
  elements: text(200),
  ending: text(200),
});
const pitchSchema = z.object({
  ideas: z.array(ideaSchema).min(1).max(PITCH_COUNT + 1),
  pick: z.number().int().catch(1),
  why: text(300),
});

/** The prompt that asks Muse, looking at the product photo, for three ideas and its pick. */
export function pitchPrompt(o: { title: string; brief?: string; seconds: number }): string {
  return [
    `You are the creative director of a short photoreal 3D product ad, about ${o.seconds} seconds, for the product in the photo.`,
    `Before any shot list, pitch ${PITCH_COUNT} film ideas for it, as different from each other as ${PITCH_COUNT} directors would make: each in its own world, time of day, light, colour and pace, with its own camera story. Not ${PITCH_COUNT} versions of one idea, and not the first idea anyone would have for this kind of product. Then pick the one that sells THIS product best, and say why.`,
    `What the film can show, so every idea can be made: the real product as a 3D body built from its photo, which can turn, tilt, drop in and rest; one world for the whole film, from a starting look (${SET_LOOKS.join(', ')}) repainted in any colours; air (${SET_AIR.join(', ')}); 2 to 4 real things round the product (solids that fall, fly, orbit or drift; liquids that splash, pour, swirl or drift; vapours that rise or wrap); a camera that can ${Object.keys(VOCAB.moves).join(', ')}; cuts between shots (${Object.keys(VOCAB.cuts).join(', ')}); a key and a rim light in any colours that can move; a colour grade; slow motion and speed ramps; and 3D words with the price at the end. It cannot show people, hands, other products, or a second place.`,
    `For each idea write: name (a few words), world (the place and its colours), mood (a few words), light (where it comes from, its colours, bright or dark), colour (the film's palette and grade), camera (how the camera tells the story, shot to shot), elements (the real things round the product and what they do), ending (how the last shot lands).`,
    ...(o.brief?.trim() ? [`The client's brief, in their own words (keep its facts): ${o.brief.trim().slice(0, 600)}`] : []),
    `Product: ${o.title}.`,
    `Reply with JSON only: {"ideas":[{"name","world","mood","light","colour","camera","elements","ending"}, ...${PITCH_COUNT} in all],"pick":1 to ${PITCH_COUNT},"why":"one sentence"}`,
  ].join('\n');
}

/** Reads Muse's reply; undefined when it holds no usable idea. A pick out of range falls back to the first idea. */
export function parsePitch(reply: unknown): Pitch | undefined {
  const raw = typeof reply === 'string' ? safeJson(reply) : reply;
  const r = pitchSchema.safeParse(raw);
  if (!r.success) return undefined;
  const ideas = r.data.ideas.filter((i) => i.name && i.world).slice(0, PITCH_COUNT);
  if (!ideas.length) return undefined;
  const at = r.data.pick >= 1 && r.data.pick <= ideas.length ? r.data.pick - 1 : 0;
  return { ideas, chosen: ideas[at]!, why: r.data.why };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** The chosen idea as the board prompt shows it. */
export function ideaLines(idea: Idea): string[] {
  return [
    `THE IDEA you chose for this film, before writing the board. Write the board from it: its concept, set and palette, light, grade, camera, elements and end card follow this idea; every detail is still yours.`,
    `- ${idea.name}`,
    ...(['world', 'mood', 'light', 'colour', 'camera', 'elements', 'ending'] as const).filter((k) => idea[k]).map((k) => `- ${k}: ${idea[k]}`),
  ];
}

/** One Muse call: three ideas and a pick. Undefined when the call fails or the reply holds no idea; the board is then written without one. */
export async function pitchIdeas(ctx: ToolCtx, o: { title: string; brief?: string; photo: Buffer; seconds: number }): Promise<Pitch | undefined> {
  try {
    const reply = await ctx.meta.spark.reviewImages([o.photo], pitchPrompt(o), undefined, { temperature: BOARD_TEMPERATURE });
    ctx.ledger.add(ctx.filmId, 'muse-spark-1.3-contributor', '1 call', 0.005);
    return parsePitch(reply);
  } catch {
    return undefined;
  }
}
