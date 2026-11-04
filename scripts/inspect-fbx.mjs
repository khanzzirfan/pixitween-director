// Prints what an FBX holds: meshes, bones, size and animation clips. Usage: node scripts/inspect-fbx.mjs file.fbx
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const buf = readFileSync(process.argv[2]);
const g = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
let meshes = 0, bones = 0, skinned = 0;
g.traverse((o) => { if (o.isMesh) meshes++; if (o.isSkinnedMesh) skinned++; if (o.isBone) bones++; });
const box = new THREE.Box3().setFromObject(g);
const s = box.getSize(new THREE.Vector3());
console.log(JSON.stringify({ file: process.argv[2], meshes, skinned, bones, size: [s.x, s.y, s.z].map((n) => +n.toFixed(2)), clips: g.animations.map((a) => `${a.name} ${a.duration.toFixed(2)}s`) }, null, 1));
