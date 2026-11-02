// Prints what a GLB holds: skinned meshes, bones, size in metres, materials and clip names. Usage: node scripts/inspect-glb.mjs file.glb
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const buf = readFileSync(process.argv[2]);
const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
let skinned = 0, bones = 0;
const colours = new Set();
gltf.scene.traverse((o) => { if (o.isSkinnedMesh) skinned++; if (o.isBone) bones++; if (o.isMesh) [].concat(o.material).forEach((m) => m.color && colours.add(m.color.getHexString())); });
const s = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
console.log(JSON.stringify({ file: process.argv[2], skinned, bones, sizeM: [s.x, s.y, s.z].map((n) => +n.toFixed(2)), colours: [...colours].slice(0, 8), clips: gltf.animations.map((a) => a.name) }));
