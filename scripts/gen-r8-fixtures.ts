// Writes the director films the R8 guard converts: every retail look, the catalog variant film and the 3D hero,
// all on fixed assets and fixed inputs so the files are deterministic. Usage: npx tsx scripts/gen-r8-fixtures.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { LOOKS, type LookId } from '../server/authoring/looks';
import { baseFromPlate, buildRetailClip, plateOverscan, retailLayout, type ClipAsset } from '../server/authoring/retail-clip';
import { buildVariantFilm } from '../server/authoring/variant-film';
import { buildHero3DClip } from '../server/authoring/hero3d-clip';

const OUT = 'fixtures/r8';
/** A plate's read (scripts/read-plate.ts) rides with it when there is one; the pack then stands on the surface it names. */
const asset = (id: string, width: number, height: number): ClipAsset => {
  const read = `fixtures/plates/${id}.json`;
  const map = existsSync(read) ? (JSON.parse(readFileSync(read, 'utf8')) as ClipAsset['map']) : undefined;
  return { id, src: `/api/assets/${id}`, width, height, ...(map ? { map: { surfaces: map.surfaces, busy: map.busy } } : {}) };
};
const can = asset('ast_5f70b53ecd06e5ce73d07b8d26bd69f0', 256, 752);
const plate = asset('ast_e7b2d1aa618305df4333d651eef26655', 720, 1280);
// the generated plates of the three looks that show a surface (web/public/cartoon/look-plates.json); the rest use the stock plate
const PLATES: Partial<Record<LookId, ClipAsset>> = {
  'tabletop-hero': asset('ast_04d50dc418756070b185948227520d4f', 720, 1280),
  'lifestyle-room': asset('ast_68b3384c20af9d5f439e96cf898dfa21', 720, 1280),
  'studio-pedestal': asset('ast_add1f1d051aba8d1c18e86ebf97f837c', 720, 1280),
};
const label = asset('ast_ddcbcbd3e609a7290ce14d77aaebae9f', 2048, 1024);

/** Where retailLayout() placed the pack, badge and window on the 9:16 frame: the e2e probes read this instead of hard-coding pixels. */
export const buildR8Layout = () => {
  const map = PLATES['tabletop-hero']?.map;
  const baseY = map ? baseFromPlate(map, plateOverscan(LOOKS['tabletop-hero'])) : undefined;
  return retailLayout(1080, 1920, { width: can.width, height: can.height }, { brand: true, ...(baseY !== undefined ? { baseY } : {}) });
};

export function buildR8Films(): Record<string, unknown> {
  const films: Record<string, unknown> = {};
  for (const look of Object.keys(LOOKS) as LookId[]) {
    films[`retail-${look}`] = buildRetailClip({
      aspect: '9:16',
      look,
      plate: PLATES[look] ?? plate,
      product: can,
      title: 'Coffee Co. Cold Brew 330ml',
      subtitle: '330 ml  |  Smooth, low acid',
      price: 4.5,
      ...(look === 'price-promo' ? { wasPrice: 5.99 } : {}),
      brand: 'Coffee Co.',
      accent: '#7a3b12',
    });
  }
  const variants = [
    { product: can, name: 'Original', color: '#3b2314', price: 4.5 },
    { product: can, name: 'Vanilla Cream', color: '#e8c872', price: 4.75 },
    { product: can, name: 'Mocha', color: '#a0522d', price: 4.75, wasPrice: 5.5 },
  ];
  const variantBase = { brand: 'Coffee Co.', tagline: 'Pick your cold brew', accent: '#7a3b12', variants };
  films['variant-9x16'] = buildVariantFilm({ aspect: '9:16', ...variantBase });
  films['variant-1x1'] = buildVariantFilm({ aspect: '1:1', ...variantBase });
  films['hero3d-can'] = buildHero3DClip({
    aspect: '9:16',
    texture: { ...label, kind: 'label' },
    shape: 'can',
    side: '#e8e0ce',
    productAspect: 3.075,
    title: 'Coffee Co. Cold Brew',
    price: 4.5,
    brand: 'Coffee Co.',
    accent: '#7a3b12',
  });
  return films;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(OUT, { recursive: true });
  const films = buildR8Films();
  for (const [name, film] of Object.entries(films)) writeFileSync(`${OUT}/${name}.json`, JSON.stringify(film, null, 2));
  writeFileSync(`${OUT}/layout.json`, JSON.stringify(buildR8Layout(), null, 2));
  console.log(`wrote ${Object.keys(films).length} films to ${OUT}`);
}
