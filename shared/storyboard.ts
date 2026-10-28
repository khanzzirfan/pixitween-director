import { z } from 'zod';

export const MAX_FILM_SECONDS = 30;
// The cap itself is enforced by the director, not by this schema.
export const MAX_GENERATE_SCENES = 2;

export const sceneSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/),
  durationSec: z.number().min(2).max(8),
  intent: z.string().min(1).max(300),
  shotType: z.enum(['hero', 'detail', 'lifestyle', 'reveal', 'closer']),
  camera: z.enum(['static', 'dolly-in', 'pan', 'orbit', 'parallax']),
  layersWanted: z.array(z.enum(['bg', 'product', 'subject', 'headline', 'caption'])).min(1),
  text: z.string().max(120).optional(),
  mode: z.enum(['motion', 'generate']),
  modeReason: z.string().min(1).max(240),
  estCredits: z.number().min(0).optional(),
});

export const storyboardSchema = z
  .object({
    title: z.string().min(1).max(80),
    aspect: z.enum(['16:9', '9:16', '1:1']),
    durationSec: z.number().max(MAX_FILM_SECONDS),
    palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).min(1).max(6),
    scenes: z.array(sceneSchema).min(2).max(6),
  })
  .superRefine((sb, ctx) => {
    const total = sb.scenes.reduce((n, s) => n + s.durationSec, 0);
    if (total > MAX_FILM_SECONDS) {
      ctx.addIssue({ code: 'custom', path: ['scenes'], message: `scene durations sum to ${total}s, over the ${MAX_FILM_SECONDS}s limit` });
    }
    const seen = new Set<string>();
    sb.scenes.forEach((s, i) => {
      if (seen.has(s.id)) ctx.addIssue({ code: 'custom', path: ['scenes', i, 'id'], message: `duplicate scene id '${s.id}'` });
      seen.add(s.id);
    });
  });

export type Scene = z.infer<typeof sceneSchema>;
export type Storyboard = z.infer<typeof storyboardSchema>;
