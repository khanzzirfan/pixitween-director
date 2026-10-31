// Converts one FBX to a binary glTF (.glb) with three: scaled from centimetres to metres, animations kept.
// Usage: node scripts/fbx-to-glb.mjs in.fbx out.glb [scale] [recolor]
// recolor swaps material colours: 'ffffff=d6322c,212b25=e6d8bf' (a pack's textures are not read, so a textured model comes out white)
import { readFileSync, writeFileSync } from 'node:fs';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// the exporter reads blobs with FileReader, which Node does not have
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((r) => { this.result = r; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then((r) => { this.result = `data:${blob.type};base64,${Buffer.from(r).toString('base64')}`; this.onloadend?.(); }); }
};
// clip names the film cues by: the library's short names
const SHORT = { Walking: 'Walk', Running: 'Run', Sitting: 'Sit', Standing: 'Stand' };
const [, , inFile, outFile, scale = '0.01', recolor = ''] = process.argv;
const swap = new Map(recolor.split(',').filter(Boolean).map((p) => p.split('=')));
const buf = readFileSync(inFile);
const g = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
g.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) { const to = m.color && swap.get(m.color.getHexString()); if (to) m.color.set(`#${to}`); } });
g.scale.setScalar(Number(scale));
g.updateMatrixWorld(true);
// tracks that drive a node which is not a bone (the armature group) make the engine reject the whole clip
const bones = new Set();
g.traverse((o) => { if (o.isBone) bones.add(o.name); });
for (const a of g.animations) a.tracks = a.tracks.filter((t) => bones.has(t.name.split('.')[0]));
const out = await new GLTFExporter().parseAsync(g, { binary: true, animations: g.animations.map((a) => { a.name = SHORT[a.name.split('|').pop().replace(/^Robot_/, '')] ?? a.name.split('|').pop().replace(/^Robot_/, ''); return a; }) });
writeFileSync(outFile, Buffer.from(out));
console.log(`${outFile}: ${(out.byteLength / 1024).toFixed(0)} KB, ${g.animations.length} clips`);
