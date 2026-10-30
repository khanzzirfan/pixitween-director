import type { Buffer } from 'node:buffer';
import type { Aspect } from '@shared/composition';
import type { ChatMessage } from '@shared/ports';
import type { Scene } from '@shared/storyboard';
import { loadEnv } from '../../env';

export const STUB_OWNER = 'S3b' as const;

const storyboardTemplate = `You are the director of short product films for small businesses. You plan a film as a storyboard; another step builds it as layers on a timeline.

Rules
1. Plan a film of about {targetSec} seconds in {aspect} with {sceneCount} scenes. Every scene lasts 2 to 8 seconds. The total never exceeds 30 seconds.
2. The attached photo is the product. Every scene shows it, except a pure text card.
3. mode: choose "motion" by default. A motion scene is told with still images, cut-outs, text and camera moves. Choose "generate" ONLY when the scene needs physical motion that a still image cannot fake: liquids pouring or splashing, cloth moving, a person walking or turning, hands using the product. Use "generate" for at most 2 scenes in the whole film. In modeReason give ONE sentence: for motion, why stills are enough; for generate, what physical motion is needed.
4. camera is one of: static, dolly-in, pan, orbit, parallax. Prefer dolly-in or parallax for product shots and static for text cards.
5. layersWanted uses only: bg, product, subject, headline, caption. Every scene needs bg and product (unless it is a text card). Add headline for the message of the scene. Add subject only if a person or a hand is essential.
6. text is the on-screen headline: at most 6 words, or "" for none. Never invent claims, prices, discounts, awards or brand names that the brief does not contain.
7. palette: 2 to 4 hex colours that suit the product and the brief.
8. The last scene is the closer: shotType "closer", showing the product with the short call to action from the brief.
9. shotType is one of: hero, detail, lifestyle, reveal, closer.
Answer with JSON only, matching the schema.

Example 1
Brief: "Cold brew in a can, calm mornings, end on the can."  Product photo: a matte black can.
{"title":"Cold Brew, Slowly","palette":["#f5e6d3","#1f1a17","#c8742a"],"scenes":[
 {"id":"a","durationSec":4,"intent":"Slow push-in on the can on a sunlit counter","shotType":"hero","camera":"dolly-in","layersWanted":["bg","product","headline"],"text":"Slow mornings","mode":"motion","modeReason":"A single product on a counter can be told with a layered still and a slow push-in."},
 {"id":"b","durationSec":4,"intent":"Cold brew pours over ice into a glass beside the can","shotType":"lifestyle","camera":"static","layersWanted":["bg","product"],"text":"","mode":"generate","modeReason":"Liquid pouring over ice needs real fluid motion that a still cannot show."},
 {"id":"c","durationSec":4,"intent":"The can centred with the call to action","shotType":"closer","camera":"parallax","layersWanted":["bg","product","headline"],"text":"Cold brew, ready","mode":"motion","modeReason":"A hero shot with text needs only a still and gentle parallax."}]}

Example 2
Brief: "Handmade lavender soap, simple and natural."  Product photo: a purple soap bar on a wooden dish.
{"title":"Lavender, Simply","palette":["#efe6f5","#5b4b8a","#2f2a3a"],"scenes":[
 {"id":"a","durationSec":3,"intent":"The soap bar on its dish, soft light","shotType":"hero","camera":"dolly-in","layersWanted":["bg","product","headline"],"text":"Simply lavender","mode":"motion","modeReason":"A still life is told well with a slow push-in."},
 {"id":"b","durationSec":3,"intent":"Close detail of the soap texture","shotType":"detail","camera":"pan","layersWanted":["bg","product"],"text":"","mode":"motion","modeReason":"A texture close-up needs only a still and a slow pan."},
 {"id":"c","durationSec":3,"intent":"The soap with the closing line","shotType":"closer","camera":"static","layersWanted":["bg","product","headline"],"text":"Handmade with care","mode":"motion","modeReason":"A closing card needs no motion beyond text."}]}`;

export function parseTargetSeconds(brief: string): number | undefined {
  const match = /\b(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i.exec(brief);
  return match ? Math.min(30, Math.max(8, Number(match[1]))) : undefined;
}

/** The motion / generate rule (3) of the template, and the same rule with the third mode, for a film that may show the product turning in 3D. */
const RULE_MOTION_GENERATE = storyboardTemplate.split('\n').find((l) => l.startsWith('3. mode:'))!;
const RULE_THREE_WAY = `3. mode: pick the cheapest technique that can tell the shot. Use 3d when the shot is about the product itself turning, catching the light or being revealed, and the product is rigid packaging (can, bottle, box, jar, tube, pouch). The 3d mode makes the real product, with the label from its photo, turn in studio light at no cost. Use generate only for physics a still can't fake: liquids pouring or splashing, cloth moving, a person walking or turning, hands using the product, and for at most 2 scenes in the whole film. Use motion for everything else: a motion scene is told with still images, cut-outs, text and camera moves. Use 3d for at most 2 scenes, and not for a soft or deformable product. In modeReason give ONE sentence: for motion, why stills are enough; for 3d, why the product itself should turn; for generate, what physical motion is needed. Also return productShape: the packaging shape of the product in the photo (can, bottle, box, jar, tube, pouch or other).`;
const EXAMPLE_3D = `

Example 3
Brief: "Sparkling water in a can, crisp and clean, end on the can."  Product photo: a silver can with a blue label.
{"title":"Crisp, Clean","palette":["#e8f1f8","#1f3a5f","#8fb8de"],"productShape":"can","scenes":[
 {"id":"a","durationSec":4,"intent":"The can turns slowly in soft studio light","shotType":"hero","camera":"static","layersWanted":["bg","product","headline"],"text":"Crisp and clean","mode":"3d","modeReason":"The product itself is the shot, so the real can should turn and catch the light."},
 {"id":"b","durationSec":4,"intent":"A condensation close-up on a cool surface","shotType":"detail","camera":"parallax","layersWanted":["bg","product"],"text":"","mode":"motion","modeReason":"A texture close-up needs only a still and a slow parallax."},
 {"id":"c","durationSec":4,"intent":"The can centred with the call to action","shotType":"closer","camera":"dolly-in","layersWanted":["bg","product","headline"],"text":"Open one","mode":"motion","modeReason":"A closing card needs only a still and a push-in."}]}`;

export function buildStoryboardSystemPrompt(o: { aspect: Aspect; sceneCount: number; targetSec: number; product3d?: boolean }): string {
  const three = o.product3d ?? loadEnv().PRODUCT_3D;
  return (three ? storyboardTemplate.replace(RULE_MOTION_GENERATE, RULE_THREE_WAY) + EXAMPLE_3D : storyboardTemplate)
    .replaceAll('{targetSec}', String(o.targetSec))
    .replaceAll('{aspect}', o.aspect)
    .replaceAll('{sceneCount}', String(o.sceneCount));
}

export function buildStoryboardMessages(o: { brief: string; title?: string; aspect: Aspect; productJpeg?: Buffer; product3d?: boolean }): ChatMessage[] {
  const sceneCount = 3;
  const targetSec = parseTargetSeconds(o.brief) ?? Math.min(30, Math.max(8, 4 * sceneCount));
  const system = buildStoryboardSystemPrompt({ aspect: o.aspect, sceneCount, targetSec, product3d: o.product3d });
  const text = `Product name: ${o.title?.trim() || 'not provided'}\nAspect: ${o.aspect}\nBrief: ${o.brief}`;
  const content = o.productJpeg
    ? [
        { type: 'text' as const, text },
        { type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${o.productJpeg.toString('base64')}` } },
      ]
    : text;
  return [
    { role: 'system', content: system },
    { role: 'user', content },
  ];
}

export function buildScenePrompt(o: {
  canvas: { width: number; height: number; aspect: Aspect };
  scene: Scene;
  palette: string[];
  product: { assetId: string; width: number; height: number };
  toolNames: string[];
}): string {
  const { scene } = o;
  const hasArt = o.toolNames.includes('generatePlate') && o.toolNames.includes('placeProduct');
  const is3d = scene.mode === '3d' && hasArt && o.toolNames.includes('placeProduct3D');
  const noun = o.scene.intent.match(/\b(?:mug|bottle|cup|soap|can|shoe|jar|bag|box)\b/i)?.[0] ?? 'product';
  const firstSteps = hasArt
    ? `1. bg: generatePlate({sceneId:"${scene.id}"}).\n2. product: placeProduct({sceneId:"${scene.id}", source:"photo", noun:"${noun}"}).\nWhen you call placeProduct or addSubject always pass \`noun\`: a short noun phrase naming the thing to cut out (for example mug, bottle, hand); it is used to find the object in the picture.`
    : `1. bg: addLayer({sceneId:"${scene.id}", role:"bg", kind:"shape", fill:"${o.palette[0] ?? '#111827'}"}).\n2. product: addLayer({sceneId:"${scene.id}", role:"product", kind:"image", assetId:"${o.product.assetId}"}).`;
  const turn = is3d
    ? `\n2b. 3D: placeProduct3D({sceneId:"${scene.id}"}). It replaces the product layer with the real product turning in studio light (layer "${scene.id}:product3d"); do not animate the product's scale or position yourself.`
    : '';
  const headline = scene.text
    ? `\n3. headline: addLayer({sceneId:"${scene.id}", role:"headline", kind:"text", text:"${scene.text}", style:{color:"${o.palette[1] ?? '#ffffff'}"}}), then setKeyframes({layerId:"${scene.id}:headline", prop:"opacity", keys:[[0,0],[0.6,1]], ease:"easeOut"}).`
    : '';
  const entrance =
    scene.camera === 'dolly-in' || is3d
      ? ''
      : `\n4. Entrance: setKeyframes({layerId:"${scene.id}:product", prop:"scale", keys:[[0,0.92],[${scene.durationSec},1]], ease:"easeOut"}) (skip when the camera move is dolly-in).`;
  const cameraStep = String(3 + Number(Boolean(scene.text)) + Number(scene.camera !== 'dolly-in' && !is3d) + 1);
  return `You are building ONE scene of a product film as layers on a timeline, by calling tools. You may call several tools in one turn. Prefer calling every tool needed for the whole scene in a single turn, then answer DONE.

Canvas: ${o.canvas.width}x${o.canvas.height} px (${o.canvas.aspect}), 30 fps. Times are seconds from the start of the scene. Positions are pixels from the top-left. Scale is a fraction (1 = 100%). The scene already exists.
Scene ${scene.id}: ${scene.durationSec} s, mode ${scene.mode}. Intent: ${scene.intent}
Camera move: ${scene.camera}. Layers wanted: ${scene.layersWanted.join(', ')}. Headline text: "${scene.text ?? ''}" (none if empty). Palette: ${o.palette.join(', ')}.
Product photo asset id: ${o.product.assetId} (${o.product.width}x${o.product.height} px).

Recipe (follow it in this order):
${firstSteps}${turn}${headline}${entrance}
${cameraStep}. setCamera({sceneId:"${scene.id}", move:"${scene.camera}"}) LAST.
Layer ids are always "<sceneId>:<role>" and are returned by addLayer; never pass a layer id when adding a layer. If a tool returns ok:false, read the error, fix the arguments, and retry only that call once. When the scene is complete reply with the single word DONE.`;
}
