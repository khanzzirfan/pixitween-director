import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildGeometry } from './geometry';

function boundingSize(geometry: THREE.BufferGeometry): THREE.Vector3 {
  geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  geometry.boundingBox?.getSize(size);
  return size;
}

describe('buildGeometry', () => {
  it('box size [1, 2, 3] gives a 1 x 2 x 3 bounding box', () => {
    const size = boundingSize(buildGeometry({ type: 'box', size: [1, 2, 3] }));
    expect(size.x).toBeCloseTo(1, 6);
    expect(size.y).toBeCloseTo(2, 6);
    expect(size.z).toBeCloseTo(3, 6);
  });

  it('sphere radius 0.5 gives a bounding sphere radius 0.5', () => {
    const geometry = buildGeometry({ type: 'sphere', radius: 0.5 });
    geometry.computeBoundingSphere();
    expect(geometry.boundingSphere?.radius).toBeCloseTo(0.5, 6);
  });

  it('uses the segment counts from the spec', () => {
    const sphere = buildGeometry({ type: 'sphere', radius: 1 }) as THREE.SphereGeometry;
    expect(sphere.parameters.widthSegments).toBe(48);
    expect(sphere.parameters.heightSegments).toBe(32);

    const cylinder = buildGeometry({ type: 'cylinder', radiusTop: 0.4, radiusBottom: 0.6, height: 2 }) as THREE.CylinderGeometry;
    expect(cylinder.parameters.radialSegments).toBe(48);

    const torus = buildGeometry({ type: 'torus', radius: 0.8, tube: 0.24 }) as THREE.TorusGeometry;
    expect(torus.parameters.radialSegments).toBe(32);
    expect(torus.parameters.tubularSegments).toBe(96);
  });

  it('builds a cylinder with the given height and widest radius', () => {
    const size = boundingSize(buildGeometry({ type: 'cylinder', radiusTop: 0.4, radiusBottom: 0.6, height: 2 }));
    expect(size.y).toBeCloseTo(2, 6);
    expect(size.x).toBeCloseTo(1.2, 6);
    expect(size.z).toBeCloseTo(1.2, 6);
  });

  it('builds a torus whose ring spans radius plus tube', () => {
    const size = boundingSize(buildGeometry({ type: 'torus', radius: 0.8, tube: 0.24 }));
    // TorusGeometry lies in the XY plane, so the ring's outer diameter (radius + tube) is on x and y
    // and the tube's thickness is on z; assert the dimensions regardless of orientation.
    const dimensions = [size.x, size.y, size.z].sort((a, b) => a - b);
    expect(dimensions[0]).toBeCloseTo(0.48, 6);
    expect(dimensions[1]).toBeCloseTo(2.08, 6);
    expect(dimensions[2]).toBeCloseTo(2.08, 6);
  });

  it('builds a flat plane from a two-element size', () => {
    const size = boundingSize(buildGeometry({ type: 'plane', size: [2, 3] }));
    expect(size.x).toBeCloseTo(2, 6);
    expect(size.y).toBeCloseTo(3, 6);
    expect(size.z).toBeCloseTo(0, 6);
  });

  it('lathe can: width and height set the body, v follows the real height fraction', () => {
    const geometry = buildGeometry({ type: 'lathe', shape: 'can', width: 1, height: 3.08 });
    const size = boundingSize(geometry);
    expect(size.x).toBeCloseTo(1, 2);
    expect(size.y).toBeCloseTo(3.08, 6);
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getY(i)).toBeLessThanOrEqual(1);
    }
  });

  it('extrude: flips the y-down contour, centres it, and extrudes depth about z = 0', () => {
    const contour: Array<[number, number]> = [[0, 0], [100, 0], [100, 50], [0, 50]];
    const geometry = buildGeometry({ type: 'extrude', contour, depth: 20 });
    const size = boundingSize(geometry);
    expect(size.x).toBeCloseTo(100, 5);
    expect(size.y).toBeCloseTo(50, 5);
    expect(size.z).toBeCloseTo(20, 5);
    const box = geometry.boundingBox as THREE.Box3;
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 5);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 5);
    // y is flipped: the contour's first point (top-left in image space) ends up above the centre.
    const position = geometry.getAttribute('position');
    let topLeft = false;
    for (let i = 0; i < position.count; i++) if (Math.abs(position.getX(i) + 50) < 1e-6 && Math.abs(position.getY(i) - 25) < 1e-6) topLeft = true;
    expect(topLeft).toBe(true);
  });

  it('extrude: two material groups, caps then sides', () => {
    const geometry = buildGeometry({ type: 'extrude', contour: [[0, 0], [1, 0], [1, 1]], depth: 1, bevel: 0.1 });
    expect(geometry.groups.map((g) => g.materialIndex)).toEqual([0, 1]);
  });
});
