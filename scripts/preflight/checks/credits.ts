// Owned by S10. Every image, audio, video and font file that ships is named in ASSET-CREDITS.md.
import { fail, pass, type CheckResult, type PreflightCtx } from '../types';

const MEDIA = /\.(png|jpe?g|webp|gif|svg|mp4|webm|mov|wav|mp3|ogg|ttf|otf|woff2?)$/i;
const IGNORED = /(^|\/)(node_modules|dist)\//;

export function checkAssetCredits(ctx: PreflightCtx): CheckResult[] {
  const title = 'every media file is credited';
  const text = ctx.readText('ASSET-CREDITS.md');
  if (text === undefined) return [fail('assets.credits', title, 'ASSET-CREDITS.md is missing')];
  // a row such as `fixtures/seed/*` credits everything under that folder
  const folders = [...text.matchAll(/([\w./-]+)\/\*/g)].map((m) => `${m[1]!.replace(/^\.\//, '')}/`);
  const media = ctx.tracked.filter((p) => MEDIA.test(p) && !IGNORED.test(p));
  const uncredited = media.filter((p) => !text.includes(p) && !folders.some((f) => p.startsWith(f)));
  return uncredited.length ? [fail('assets.credits', title, `not in ASSET-CREDITS.md: ${uncredited.join(', ')}`)] : [pass('assets.credits', title, `${media.length} media files`)];
}
