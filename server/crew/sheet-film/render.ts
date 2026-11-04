import type { Buffer } from 'node:buffer';
import sharp from 'sharp';
import type { ToolCtx } from '@shared/tools';
import { emitAsset } from '../../art/events';
import type { Comp } from '../../authoring/types';
import type { TurnaroundViews } from '../../product3d/turnaround';
import { composeSheet, labelCrop, swatchesOf } from './compose';
import { elementSheetComp, panelTimes, productSheetComp, setSheetComp, sheetLabels } from './sheets';

export interface PartSheets {
  product?: Buffer;
  elements?: Buffer;
  set?: Buffer;
  /** the turnaround sheet, when Muse drew one (saved first, so it is the first thumbnail) */
  turnaround?: Buffer;
  /** the asset of each sheet that was saved, in the order turnaround (when drawn), product, elements, set */
  assetIds: string[];
  /** the sheets that could not be drawn, with why */
  skipped: string[];
}

type Render = (comp: Comp, times: number[]) => Promise<Buffer[]>;


/** Draws the product, element and set sheets of a built film, saves each as a film asset (role 'sheet') and tells the app. A sheet with nothing to show
 * is left out; a sheet that fails to draw is skipped and the others are kept. Throws only when none could be drawn. */
export async function drawSheets(ctx: ToolCtx, o: { film: Comp; photo: Buffer; render: Render; turnaround?: { views: TurnaroundViews; sheet?: Buffer } }): Promise<PartSheets> {
  const labels = sheetLabels(o.film);
  const productComp = productSheetComp(o.film);
  const elementComp = elementSheetComp(o.film);
  const setComp = setSheetComp(o.film);

  const names = ['product', 'elements', 'set'] as const;
  const drawn = await Promise.allSettled([productComp, elementComp, setComp].map((comp) => (comp ? o.render(comp, panelTimes(comp)) : Promise.resolve(undefined))));
  const skipped = drawn.flatMap((d, i) => (d.status === 'rejected' ? [`${names[i]}: ${d.reason instanceof Error ? d.reason.message : String(d.reason)}`] : []));
  if (skipped.length && drawn.every((d) => d.status === 'rejected' || !d.value)) throw new Error(skipped.join('; '));
  const [turns, elementShots, setShots] = drawn.map((d) => (d.status === 'fulfilled' ? d.value : undefined));

  // the drawn views head the product sheet, flattened on the sheet's grey so their clear background reads as a field
  const views = o.turnaround?.views;
  const flat = (png: Buffer) => sharp(png).flatten({ background: '#7d7d80' }).png().toBuffer();
  const drawnRow = views
    ? [
        { png: await flat(views.front), label: 'front (the real photo)' },
        ...(views.side ? [{ png: await flat(views.side), label: 'side (drawn)' }] : []),
        { png: await flat(views.back), label: views.side ? 'back (drawn)' : 'back (photo)' },
      ]
    : [];

  const jpegs: Array<Buffer | undefined> = [
    turns
      ? await composeSheet({
          title: views ? 'Product sheet: the drawn views, the photo, then the 3D product turned' : 'Product sheet: the photo, then the 3D product turned',
          panels: [...drawnRow, { png: o.photo, label: 'photo' }, ...turns.map((png, i) => ({ png, label: labels.product[i] ?? `turn ${i + 1}` })), { png: await labelCrop(turns[0]!), label: 'label close-up' }],
          columns: 3,
          swatches: [...(await swatchesOf(o.photo)), ...(await swatchesOf(turns[0]!))],
        })
      : undefined,
    elementShots ? await composeSheet({ title: 'Element sheet: each element alone', panels: elementShots.map((png, i) => ({ png, label: labels.elements[i] ?? `element ${i + 1}` })), columns: 3 }) : undefined,
    setShots ? await composeSheet({ title: 'Set sheet: the empty set under the film light', panels: setShots.map((png, i) => ({ png, label: labels.set[i] ?? `view ${i + 1}` })), columns: 2, swatches: await swatchesOf(setShots[0]!) }) : undefined,
  ];

  const out: PartSheets = { assetIds: [], skipped };
  if (o.turnaround?.sheet) {
    // first, so it is the first thumbnail in the Plan panel
    const jpeg = await sharp(o.turnaround.sheet).jpeg({ quality: 88 }).toBuffer();
    const ref = await ctx.assets.put(jpeg, 'image/jpeg', { role: 'sheet' });
    emitAsset(ctx, ref);
    out.assetIds.push(ref.id);
    out.turnaround = jpeg;
  }
  for (const [i, jpeg] of jpegs.entries()) {
    if (!jpeg) continue;
    const ref = await ctx.assets.put(jpeg, 'image/jpeg', { role: 'sheet' });
    emitAsset(ctx, ref);
    out.assetIds.push(ref.id);
    if (i === 0) out.product = jpeg;
    else if (i === 1) out.elements = jpeg;
    else out.set = jpeg;
  }
  return out;
}
