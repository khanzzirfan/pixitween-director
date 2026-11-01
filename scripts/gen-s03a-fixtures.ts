// Deterministic, offline: builds three films with the pure authoring API into fixtures/s03a/valid/*.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  addLayer, addScene, newFilmComposition, registerAsset, setCamera, setKeyframes, summariseComposition,
  type Aspect, type CameraMove, type Comp,
} from '../server/authoring/api';

const ASSET = 'ast_00000000000000000000000000000192';
const JPEG = new URL('../fixtures/s03a/mug-192.jpg', import.meta.url);
const OUT = (name: string) => new URL(`../fixtures/s03a/valid/${name}.json`, import.meta.url);

function film(jpeg: Buffer, title: string, aspect: Aspect, move: CameraMove, headlines: string[]): Comp {
  let c = newFilmComposition({ aspect, title, palette: ['#111827'] });
  c = registerAsset(c, { id: ASSET, kind: 'image', src: `data:image/jpeg;base64,${jpeg.toString('base64')}`, width: 192, height: 336 });
  headlines.forEach((text, i) => {
    const id = `s${i + 1}`;
    c = addScene(c, { id, durationSec: 4, mode: 'motion', intent: `${title}, scene ${i + 1}` });
    c = addLayer(c, { sceneId: id, role: 'bg', kind: 'shape', fill: '#111827' });
    c = addLayer(c, { sceneId: id, role: 'product', kind: 'image', assetId: ASSET });
    c = addLayer(c, { sceneId: id, role: 'headline', kind: 'text', text });
    c = setKeyframes(c, `${id}:headline`, 'opacity', [[0, 0], [0.6, 1]], 'easeOut');
    c = setCamera(c, id, move);
  });
  return c;
}

export function buildFixtures(jpeg: Buffer): Record<string, Comp> {
  return {
    'two-scene-dolly': film(jpeg, 'Two scene dolly', '16:9', 'dolly-in', ['Slow mornings', 'Pour. Sip. Repeat.']),
    'three-scene-pan': film(jpeg, 'Three scene pan', '16:9', 'pan', ['Fresh start', 'Rich and smooth', 'Make it yours']),
    'vertical-parallax': film(jpeg, 'Vertical parallax', '9:16', 'parallax', ['Cold brew', 'Ready when you are']),
  };
}

export const serialise = (c: Comp): string => JSON.stringify(c, null, 2) + '\n';

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  for (const [name, c] of Object.entries(buildFixtures(readFileSync(JPEG)))) {
    writeFileSync(OUT(name), serialise(c));
    console.log(`wrote fixtures/s03a/valid/${name}.json\n${summariseComposition(c).split('\n').slice(0, 3).join('\n')}`);
  }
}
