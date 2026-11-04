import * as THREE from 'three';

// A solid body that has pictures of more than its front (a drawn back, a drawn side) wears them blended by where the camera is: each picture is laid
// on the body along its own direction (the front and back along the depth, the side across it) and weighted by how squarely the camera looks from
// that direction. Seen square on, the front is exactly the photo; turned, the drawn views take over smoothly. The geometry carries the coordinates
// as the `views` attribute (buildBody with `views`): x the photo's u straight through the body, y its v, z the side picture's u. The photo itself keeps
// the body's own coordinates (its edge eased onto the side wall), so square on it is exactly the body without drawn views.

/**
 * How sharply one picture gives way to the next as the body turns: a weight is the cosine to this power. At 4 (4 Nov) the pictures were half-blended from
 * 30 to 60 degrees and a still there showed two cages; at 12 one picture holds to within about 5 degrees of the halfway turn.
 */
const SHARPNESS = 12;

export interface ViewWeights {
  front: number;
  back: number;
  side: number;
}

/**
 * The weight of each picture for a camera at `dir` (the camera's direction from the body's centre, in the body's own space). A missing back counts as
 * the front seen from behind, so its share goes to the front; a missing side shares nothing. The weights add up to 1.
 */
export function viewWeights(dir: THREE.Vector3, has: { back: boolean; side: boolean }): ViewWeights {
  const d = dir.clone().normalize();
  const front = Math.max(d.z, 0) ** SHARPNESS;
  const back = Math.max(-d.z, 0) ** SHARPNESS;
  const side = has.side ? Math.abs(d.x) ** SHARPNESS : 0;
  const sum = front + back + side;
  // straight above or below, nothing faces the camera: the photo
  if (sum < 1e-6) return { front: 1, back: 0, side: 0 };
  return has.back ? { front: front / sum, back: back / sum, side: side / sum } : { front: (front + back) / sum, back: 0, side: side / sum };
}

const prepare = (t: THREE.Texture | undefined): THREE.Texture | null => {
  if (!t) return null;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
};

/**
 * Makes `material` (which wears the photo as its `map`) blend in the back and side pictures by view. Returns the per-frame update: call it before the
 * mesh is drawn with the camera, so the weights follow the camera.
 */
export function wearViews(material: THREE.MeshStandardMaterial, o: { back?: THREE.Texture; side?: THREE.Texture }): (mesh: THREE.Object3D, camera: THREE.Camera) => void {
  const back = prepare(o.back);
  const side = prepare(o.side);
  const uniforms = {
    viewBackMap: { value: back },
    viewSideMap: { value: side },
    viewWeights: { value: new THREE.Vector3(1, 0, 0) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 views;\nvarying vec3 vViews;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvViews = views;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vViews;\nuniform sampler2D viewBackMap;\nuniform sampler2D viewSideMap;\nuniform vec3 viewWeights;')
      .replace(
        '#include <map_fragment>',
        [
          // the photo keeps the body's own coordinates, so square on the body is exactly what it is without drawn views
          'vec4 viewFront = texture2D( map, vMapUv );',
          // the back is drawn as seen from behind, so it reads the photo's u the other way
          `vec4 viewBack = ${back ? 'texture2D( viewBackMap, vec2( 1.0 - vViews.x, vViews.y ) )' : 'viewFront'};`,
          `vec4 viewSide = ${side ? 'texture2D( viewSideMap, vViews.zy )' : 'viewFront'};`,
          'diffuseColor *= viewFront * viewWeights.x + viewBack * viewWeights.y + viewSide * viewWeights.z;',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => `views:${back ? 1 : 0}${side ? 1 : 0}`;
  material.needsUpdate = true;

  const local = new THREE.Vector3();
  const centre = new THREE.Vector3();
  return (mesh, camera) => {
    mesh.updateWorldMatrix(true, false);
    camera.getWorldPosition(local);
    mesh.worldToLocal(local);
    const box = (mesh as THREE.Mesh).geometry?.boundingBox;
    if (box) box.getCenter(centre);
    else centre.set(0, 0, 0);
    const w = viewWeights(local.sub(centre), { back: !!back, side: !!side });
    uniforms.viewWeights.value.set(w.front, w.back, w.side);
  };
}
