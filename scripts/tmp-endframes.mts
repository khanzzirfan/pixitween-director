import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { renderKeyFrames } from '../server/crew/frame-review';
for (const id of ['towel2d', 'coffee2d']) {
  const comp = JSON.parse(await readFile('/private/tmp/claude-501/-Users-irfanahmedkhan-Documents-code-clientcode-trolio-pixitween-director/7f52c2ef-7115-4644-a977-b368840a4100/scratchpad/' + id + '.json', 'utf8'));
  const D = comp.durationInFrames / comp.fps;
  const times = [0.1, 0.3, 0.5, 0.7, 0.95].map((s) => +(s * D).toFixed(2));
  const shots = await renderKeyFrames(comp, times, 'http://localhost:5173', 2000);
  const imgs = await Promise.all(shots.map((b) => sharp(b).resize(300).toBuffer()));
  const meta = await sharp(imgs[0]).metadata();
  await writeFile('/private/tmp/claude-501/-Users-irfanahmedkhan-Documents-code-clientcode-trolio-pixitween-director/7f52c2ef-7115-4644-a977-b368840a4100/scratchpad/end-' + id + '.jpg', await sharp({ create: { width: 300 * imgs.length, height: meta.height!, channels: 3, background: '#000' } }).composite(imgs.map((b, n) => ({ input: b, left: 300 * n, top: 0 }))).jpeg().toBuffer());
  console.log('ok', id, times);
}
