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
});
