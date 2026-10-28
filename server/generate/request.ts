// Owned by S7a. Pure builder: scene -> valid animate_image arguments (10 s rule, prompt limits).
import { animateImageArgsSchema, FAST_H3_MIN_SEC, FAST_H3_PROMPT_MAX, MAX_CLIP_SEC, type AnimateImageArgs } from '../clippy/types';
import { idempotencyKeyFor } from './guard';

export type ClipModel = 'fast-h3' | 'fast-h3-omni';
type Camera = 'static' | 'dolly-in' | 'pan' | 'orbit' | 'parallax';

const SOUND = /\b(pour|splash|sizzle|crackle|fizz|steam|simmer|sound)/i;
const OMNI_PROMPT_CAP = 1200;
const CAMERA_PHRASE: Record<Camera, string> = {
  static: 'Locked-off camera',
  'dolly-in': 'Slow push-in',
  pan: 'Slow pan',
  orbit: 'Slow orbit around the subject',
  parallax: 'Gentle parallax drift',
};
export const RETRY_SENTENCE = 'Keep the product clearly visible in frame for the whole clip; never let hands or objects cover it.';

export const wantsSound = (intent: string): boolean => SOUND.test(intent);

/** The smallest of [5.875, 8] that is >= sec, else 8 (10.125 would break the 10 s rule). */
export const snapOmniSeconds = (sec: number): 5.875 | 8 => (sec <= 5.875 ? 5.875 : 8);

export function clipSecondsFor(model: ClipModel, sceneSec: number): number {
  if (model === 'fast-h3-omni') return snapOmniSeconds(sceneSec);
  const r = Math.round(sceneSec * 10) / 10;
  return Math.min(MAX_CLIP_SEC, Math.max(FAST_H3_MIN_SEC, r));
}

/** Cut `text` to at most `max` characters at a sentence boundary, else at a word boundary; the result ends with . ! or ?. */
function trimToSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const ends = [...head.matchAll(/[.!?](?=\s|$)/g)];
  if (ends.length) return head.slice(0, ends[ends.length - 1]!.index! + 1);
  const room = head.slice(0, max - 1);
  const cut = room.lastIndexOf(' ');
  return `${(cut > 0 ? room.slice(0, cut) : room).trimEnd()}.`;
}

export function buildClipPrompt(o: { intent: string; camera: Camera; adjust?: boolean; omni?: boolean }): string {
  const cap = o.omni ? OMNI_PROMPT_CAP : FAST_H3_PROMPT_MAX;
  const intent = o.intent.trim().replace(/[.!?]+$/, '');
  const camera = CAMERA_PHRASE[o.camera] ?? CAMERA_PHRASE.static;
  const picture = o.omni ? ' <Picture 1> is the scene and <Picture 2> is the product.' : '';
  const tail =
    ` ${camera}. The product in the image stays in frame and keeps its exact shape, colour and label.${picture}\n` +
    `Natural, physically plausible motion only. No text, no logos, no extra products. Cinematic, shallow depth of field.` +
    (o.omni ? ' Ambient sound only, no speech, no music.' : '') +
    (o.adjust ? ` ${RETRY_SENTENCE}` : '');
  // trim the intent, never the safety sentences
  const budget = cap - tail.length - 1; // 1 for the full stop after the intent
  const head = intent.length > budget ? trimToSentence(`${intent}.`, Math.max(budget + 1, 20)) : `${intent}.`;
  return `${head}${tail}`.slice(0, cap);
}

export interface BuildRequestInput {
  filmId: string;
  aspect: '16:9' | '9:16' | '1:1';
  scene: { id: string; durationSec: number; intent: string; camera: Camera };
  stillUrl: string;
  productPhotoUrl?: string;
  attempt: number;
  adjust?: boolean;
  withSound?: boolean;
}

export function buildAnimateRequest(i: BuildRequestInput): AnimateImageArgs {
  const withSound = i.withSound ?? wantsSound(i.scene.intent);
  const model: ClipModel = withSound ? 'fast-h3-omni' : 'fast-h3';
  const idempotencyKey = idempotencyKeyFor(i.filmId, i.scene.id, i.attempt);
  const prompt = buildClipPrompt({ intent: i.scene.intent, camera: i.scene.camera, adjust: i.adjust, omni: withSound });
  const durationSec = clipSecondsFor(model, i.scene.durationSec);
  const args =
    model === 'fast-h3'
      ? { model, prompt, sourceImageUrl: i.stillUrl, durationSec, aspect: i.aspect, idempotencyKey }
      : { model, prompt, imageUrls: [i.stillUrl, ...(i.productPhotoUrl ? [i.productPhotoUrl] : [])], durationSec, aspect: i.aspect, idempotencyKey };
  return animateImageArgsSchema.parse(args);
}
