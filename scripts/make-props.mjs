// Writes the toy prop library (small low-poly GLBs, one per everyday object) into web/public/cartoon/props.
// Run: node scripts/make-props.mjs. The fixture forge picks one by the prop's name (server/cartoon/props.ts keeps the same list).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// GLTFExporter reads blobs through FileReader, which Node lacks.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = buf;
      this.onloadend?.();
    });
  }
};

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public', 'cartoon', 'props');
mkdirSync(out, { recursive: true });

const mat = (name, color, roughness = 0.8) => new THREE.MeshStandardMaterial({ name, color, roughness });
const add = (scene, name, geo, m, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = name;
  mesh.position.set(x, y, z);
  scene.add(mesh);
  return mesh;
};
const box = (w, h, d, r = 0.02) => new RoundedBoxGeometry(w, h, d, 3, r);
const cyl = (rt, rb, h, seg = 24) => new THREE.CylinderGeometry(rt, rb, h, seg);

// Each builder fills a scene whose base sits on y = 0 and fits about a 0.5 m cube.
const BUILDERS = {
  can(s) {
    add(s, 'Body', cyl(0.14, 0.14, 0.4), mat('can', '#c9d3dc', 0.35), 0, 0.2, 0);
    add(s, 'Band', cyl(0.142, 0.142, 0.16), mat('label', '#2f6fb5', 0.6), 0, 0.2, 0);
    add(s, 'Rim', cyl(0.12, 0.14, 0.03), mat('rim', '#aab4bd', 0.3), 0, 0.415, 0);
    add(s, 'Tab', box(0.06, 0.008, 0.04, 0.004), mat('tab', '#9aa4ad', 0.3), 0, 0.435, 0.02);
  },
  lamp(s) {
    add(s, 'Base', cyl(0.12, 0.14, 0.04), mat('base', '#7a5a3a'), 0, 0.02, 0);
    add(s, 'Stem', cyl(0.02, 0.02, 0.3), mat('stem', '#8a6a46'), 0, 0.19, 0);
    add(s, 'Shade', cyl(0.1, 0.18, 0.2), mat('shade', '#ffd98a', 0.9), 0, 0.42, 0);
  },
  clock(s) {
    const face = add(s, 'Body', cyl(0.18, 0.18, 0.08, 32), mat('clock', '#e8504a', 0.5), 0, 0.2, 0);
    face.rotation.x = Math.PI / 2;
    const dial = add(s, 'Dial', cyl(0.14, 0.14, 0.01, 32), mat('dial', '#fff8e8'), 0, 0.2, 0.045);
    dial.rotation.x = Math.PI / 2;
    add(s, 'HandA', box(0.015, 0.1, 0.01, 0.003), mat('hand', '#2b2b2b'), 0, 0.24, 0.055);
    add(s, 'HandB', box(0.07, 0.015, 0.01, 0.003), mat('hand2', '#2b2b2b'), 0.03, 0.2, 0.055);
    add(s, 'BellL', new THREE.SphereGeometry(0.05, 16, 12), mat('bell', '#d9b44a', 0.4), -0.12, 0.37, 0);
    add(s, 'BellR', new THREE.SphereGeometry(0.05, 16, 12), mat('bell2', '#d9b44a', 0.4), 0.12, 0.37, 0);
    add(s, 'FootL', cyl(0.015, 0.015, 0.05), mat('foot', '#2b2b2b'), -0.1, 0.02, 0);
    add(s, 'FootR', cyl(0.015, 0.015, 0.05), mat('foot2', '#2b2b2b'), 0.1, 0.02, 0);
  },
  bed(s) {
    add(s, 'Frame', box(0.5, 0.12, 0.34), mat('frame', '#9c6b3f'), 0, 0.06, 0);
    add(s, 'Mattress', box(0.46, 0.08, 0.31, 0.03), mat('mattress', '#f3ede0'), 0, 0.16, 0);
    add(s, 'Blanket', box(0.34, 0.06, 0.32, 0.03), mat('blanket', '#4f8ec9'), 0.06, 0.2, 0);
    add(s, 'Pillow', box(0.12, 0.05, 0.22, 0.03), mat('pillow', '#fffdf7'), -0.16, 0.21, 0);
    add(s, 'Headboard', box(0.04, 0.26, 0.34), mat('head', '#8a5a30'), -0.25, 0.13, 0);
  },
  counter(s) {
    add(s, 'Cabinet', box(0.5, 0.3, 0.3), mat('cabinet', '#d9c3a0'), 0, 0.15, 0);
    add(s, 'Top', box(0.54, 0.04, 0.34, 0.01), mat('top', '#6c8f9e', 0.5), 0, 0.32, 0);
    add(s, 'DoorL', box(0.2, 0.2, 0.01, 0.005), mat('door', '#c3a77c'), -0.12, 0.15, 0.155);
    add(s, 'DoorR', box(0.2, 0.2, 0.01, 0.005), mat('door2', '#c3a77c'), 0.12, 0.15, 0.155);
  },
  table(s) {
    add(s, 'Top', box(0.5, 0.04, 0.34, 0.01), mat('top', '#b8844d'), 0, 0.28, 0);
    for (const [x, z] of [[-0.21, -0.13], [0.21, -0.13], [-0.21, 0.13], [0.21, 0.13]]) add(s, 'Leg', box(0.04, 0.26, 0.04, 0.005), mat('leg', '#8a5a30'), x, 0.13, z);
  },
  window(s) {
    add(s, 'Pane', box(0.4, 0.5, 0.012, 0.004), mat('pane', '#bfe3f5', 0.2), 0, 0.3, 0);
    add(s, 'Top', box(0.46, 0.04, 0.04, 0.005), mat('frame', '#f1e6d2'), 0, 0.56, 0);
    add(s, 'Bottom', box(0.46, 0.04, 0.05, 0.005), mat('frame2', '#f1e6d2'), 0, 0.04, 0);
    add(s, 'Left', box(0.04, 0.54, 0.04, 0.005), mat('frame3', '#f1e6d2'), -0.21, 0.3, 0);
    add(s, 'Right', box(0.04, 0.54, 0.04, 0.005), mat('frame4', '#f1e6d2'), 0.21, 0.3, 0);
    add(s, 'BarV', box(0.02, 0.5, 0.03, 0.003), mat('bar', '#f1e6d2'), 0, 0.3, 0);
    add(s, 'BarH', box(0.4, 0.02, 0.03, 0.003), mat('bar2', '#f1e6d2'), 0, 0.3, 0);
  },
  rug(s) {
    add(s, 'Rug', cyl(0.25, 0.25, 0.012, 40), mat('rug', '#c4584f', 0.95), 0, 0.006, 0);
    add(s, 'Ring', cyl(0.17, 0.17, 0.014, 40), mat('ring', '#f3e3c3', 0.95), 0, 0.007, 0);
  },
  plant(s) {
    add(s, 'Pot', cyl(0.1, 0.07, 0.14), mat('pot', '#c86b45'), 0, 0.07, 0);
    add(s, 'LeafA', new THREE.SphereGeometry(0.11, 16, 12), mat('leaf', '#4f9a4f'), 0, 0.24, 0);
    add(s, 'LeafB', new THREE.SphereGeometry(0.08, 16, 12), mat('leaf2', '#62b062'), 0.07, 0.32, 0.02);
    add(s, 'LeafC', new THREE.SphereGeometry(0.07, 16, 12), mat('leaf3', '#3f8a46'), -0.06, 0.34, -0.02);
  },
  mug(s) {
    add(s, 'Cup', cyl(0.09, 0.08, 0.14), mat('mug', '#f6f1e6', 0.4), 0, 0.07, 0);
    add(s, 'Coffee', cyl(0.078, 0.078, 0.005), mat('coffee', '#3b2316', 0.3), 0, 0.138, 0);
    const handle = add(s, 'Handle', new THREE.TorusGeometry(0.04, 0.012, 8, 20), mat('handle', '#f6f1e6', 0.4), 0.1, 0.07, 0);
    handle.rotation.y = 0;
  },
  books(s) {
    add(s, 'BookA', box(0.34, 0.06, 0.24, 0.008), mat('bookA', '#c0504d'), 0, 0.03, 0);
    add(s, 'BookB', box(0.3, 0.05, 0.22, 0.008), mat('bookB', '#4f81bd'), 0.01, 0.085, 0);
    add(s, 'BookC', box(0.26, 0.05, 0.2, 0.008), mat('bookC', '#9bbb59'), -0.01, 0.135, 0);
  },
  chair(s) {
    add(s, 'Seat', box(0.3, 0.04, 0.3, 0.01), mat('seat', '#d9a45a'), 0, 0.22, 0);
    add(s, 'Back', box(0.3, 0.28, 0.04, 0.01), mat('back', '#d9a45a'), 0, 0.38, -0.13);
    for (const [x, z] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) add(s, 'Leg', box(0.035, 0.2, 0.035, 0.005), mat('leg', '#8a5a30'), x, 0.1, z);
  },
  ball(s) {
    add(s, 'Ball', new THREE.SphereGeometry(0.14, 24, 16), mat('ball', '#e8504a', 0.5), 0, 0.14, 0);
    add(s, 'Stripe', new THREE.TorusGeometry(0.14, 0.012, 8, 28), mat('stripe', '#fff8e8', 0.5), 0, 0.14, 0);
  },
};

for (const [name, build] of Object.entries(BUILDERS)) {
  const scene = new THREE.Scene();
  scene.name = name;
  build(scene);
  scene.updateMatrixWorld(true);
  const buf = await new Promise((resolve, reject) => new GLTFExporter().parse(scene, (r) => resolve(Buffer.from(r)), reject, { binary: true }));
  writeFileSync(join(out, `${name}.glb`), buf);
  console.log(`${name}.glb  ${buf.length} bytes`);
}
