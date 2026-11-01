import type { Buffer } from 'node:buffer';
import sharp from 'sharp';
import type { Aspect, AssetRef } from '@shared/composition';
import type { ToolCtx } from '@shared/tools';
import { lookPlatePrompt, type LookId, type OccasionId } from '../authoring/looks';
import { imageSize } from '../media/image';
import { MetaApiError } from '../meta/http';
import { ArtError } from './errors';
import { charge, emitAsset } from './events';
import { lintPrompt } from './lint';
import { PRICE } from './prices';

export const STUB_OWNER = 'S4' as const;
export const platePrompt = (setting: string, mood?: string) =>
  `${setting.trim()}. Cinematic photograph, shallow depth of field, soft natural light${mood?.trim() ? `, ${mood.trim()}` : ''}. Clear empty space where the product will stand. No products, no cups, no people, no text, no logos.`;
export const productEditPrompt = (noun: string, lighting = 'soft warm light from the left') =>
  `The ${noun} from the reference image, unchanged in shape, colour and printed details, ${lighting}, centred on a plain neutral studio backdrop, product photograph. Nothing else in the frame. No added text, no added logos.`;
export const subjectPrompt = (description: string) =>
  `${description.trim()}. Single subject centred on a plain neutral background, clearly separated from it, photographic. No text, no logos. A generic invented person, nobody real.`;
export const plateSizeFor = (aspect: Aspect): '1536x1024' | '1024x1536' => (aspect === '9:16' ? '1024x1536' : '1536x1024');
const aspectSize = (aspect: Aspect) =>
  aspect === '16:9' ? { width: 1920, height: 1080 } : aspect === '9:16' ? { width: 720, height: 1280 } : { width: 1280, height: 1280 };
export async function coverCrop(png: Buffer, aspect: Aspect): Promise<Buffer> {
  const target = aspectSize(aspect),
    source = await imageSize(png);
  const scale = Math.max(target.width / source.width, target.height / source.height);
  const width = Math.max(target.width, Math.round(source.width * scale)),
    height = Math.max(target.height, Math.round(source.height * scale));
  return sharp(png)
    .resize(width, height, { fit: 'fill' })
    .extract({
      left: Math.floor((width - target.width) / 2),
      top: Math.floor((height - target.height) / 2),
      width: target.width,
      height: target.height,
    })
    .png()
    .toBuffer();
}
/** A plate written from a look recipe (docs/direction/corpus/03-plate-prompts.md) instead of a free setting line. */
export async function generateLookPlate(
  ctx: ToolCtx,
  o: { look: LookId; occasion: OccasionId; productClass: string; aspect: Aspect; sceneId: string },
): Promise<AssetRef> {
  const prompt = lookPlatePrompt(o.look, o);
  if (!prompt) throw new ArtError('lint', `look '${o.look}' draws its own world and has no plate`);
  return generatePlateImage(ctx, { ...o, setting: '', prompt });
}
export async function generatePlateImage(
  ctx: ToolCtx,
  o: { setting: string; mood?: string; aspect: Aspect; sceneId: string; prompt?: string },
): Promise<AssetRef> {
  const prompt = o.prompt ?? platePrompt(o.setting, o.mood);
  const lint = lintPrompt(prompt);
  if (!lint.ok) throw new ArtError('lint', `prompt rejected: ${lint.violations.map((v) => `${v.rule} "${v.term}"`).join(', ')}`);
  let raw: Buffer;
  try {
    raw = await ctx.meta.image.generate(prompt, plateSizeFor(o.aspect));
  } catch (e) {
    if (!(e instanceof MetaApiError) || e.status !== 400 || !/size/i.test(e.message)) throw e;
    raw = await ctx.meta.image.generate(prompt, '1536x1024');
  }
  const cropped = await coverCrop(raw, o.aspect);
  const jpeg = await sharp(cropped).jpeg({ quality: 90 }).toBuffer();
  const size = await imageSize(jpeg);
  const asset = await ctx.assets.put(jpeg, 'image/jpeg', { role: 'plate', sceneId: o.sceneId, width: size.width, height: size.height });
  charge(ctx, 'muse-image-1.0', '1 image', PRICE.museImageUsd);
  emitAsset(ctx, asset);
  return asset;
}
export async function editProductImage(
  ctx: ToolCtx,
  o: { photo: Buffer; noun: string; lighting?: string; sceneId: string },
): Promise<{ asset: AssetRef; bytes: Buffer }> {
  const bytes = await ctx.meta.image.edit(productEditPrompt(o.noun, o.lighting), [o.photo], '1536x1024');
  const size = await imageSize(bytes);
  const asset = await ctx.assets.put(bytes, size.mime, { role: 'still', sceneId: o.sceneId, width: size.width, height: size.height });
  charge(ctx, 'muse-image-1.0', '1 image', PRICE.museImageUsd);
  emitAsset(ctx, asset);
  return { asset, bytes };
}
