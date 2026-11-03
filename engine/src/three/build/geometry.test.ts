import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildGeometry } from './geometry';

function boundingSize(geometry: THREE.BufferGeometry): THREE.Vector3 {
  geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  geometry.boundingBox?.getSize(size);
  return size;
}

function geometryBox(geometry: THREE.BufferGeometry): THREE.Box3 {
  geometry.computeBoundingBox();
  return geometry.boundingBox!;
}

describe('buildGeometry', () => {
  it('box size [1, 2, 3] gives a 1 x 2 x 3 bounding box', () => {
    const size = boundingSize(buildGeometry({ type: 'box', size: [1, 2, 3] }));
    expect(size.x).toBeCloseTo(1, 6);
    expect(size.y).toBeCloseTo(2, 6);
    expect(size.z).toBeCloseTo(3, 6);
  });

  it('a rounded box keeps its size and has more corners cut than a sharp one', () => {
    const round = buildGeometry({ type: 'box', size: [1, 2, 3], round: 0.2 });
    const size = boundingSize(round);
    expect([size.x, size.y, size.z].map((v) => +v.toFixed(3))).toEqual([1, 2, 3]);
    expect(round.getAttribute('position').count).toBeGreaterThan(buildGeometry({ type: 'box', size: [1, 2, 3] }).getAttribute('position').count);
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

  describe('extrude with a section: a solid body', () => {
    // a bottle: a narrow neck on a wide body, 40 wide at most and 100 tall (y down)
    const bottle: Array<[number, number]> = [[15, 0], [25, 0], [25, 30], [40, 40], [40, 100], [0, 100], [0, 40], [15, 30]];
    const body = () => buildGeometry({ type: 'extrude', contour: bottle, depth: 40, section: 2 });

    it('is centred, as wide as the outline and as deep as depth says of its widest row', () => {
      const size = boundingSize(body());
      expect(size.x).toBeCloseTo(40, 0);
      expect(size.y).toBeCloseTo(100, 0);
      expect(size.z).toBeCloseTo(40, 0);
      const box = geometryBox(body());
      expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 1);
      expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 1);
    });
    it('narrows with the outline: the neck is thinner both ways than the body', () => {
      const g = body();
      const pos = g.getAttribute('position');
      const reach = (y0: number, y1: number, axis: 'x' | 'z') => {
        let m = 0;
        for (let i = 0; i < pos.count; i++) if (pos.getY(i) >= y0 && pos.getY(i) <= y1) m = Math.max(m, Math.abs(axis === 'x' ? pos.getX(i) : pos.getZ(i)));
        return m;
      };
      // image y 0-30 is the neck (top, y up from 20 to 50), image y 50-100 the body
      expect(reach(25, 45, 'x')).toBeLessThan(reach(-50, -20, 'x'));
      expect(reach(25, 45, 'z')).toBeLessThan(reach(-50, -20, 'z'));
    });
    it('lays the photo flat on the front (u rises to the right) and reads it the other way on the back', () => {
      const g = body();
      const pos = g.getAttribute('position');
      const uv = g.getAttribute('uv');
      let front = 0;
      let back = 0;
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getY(i) + 20) > 3) continue;
        if (pos.getZ(i) > 15 && pos.getX(i) > 5) front = Math.max(front, uv.getX(i));
        if (pos.getZ(i) < -15 && pos.getX(i) > 5) back = Math.max(back, uv.getX(i));
      }
      expect(front).toBeGreaterThan(0.5);
      expect(back).toBeLessThan(0.5);
    });
    it('faces its normals outward, and none is zero', () => {
      const g = body();
      const pos = g.getAttribute('position');
      const normal = g.getAttribute('normal');
      for (let i = 0; i < pos.count; i += 7) {
        const n = new THREE.Vector3().fromBufferAttribute(normal, i);
        expect(n.length()).toBeGreaterThan(0.99);
        const p = new THREE.Vector3().fromBufferAttribute(pos, i);
        if (Math.abs(p.z) > 10 && Math.abs(p.y) < 45) expect(Math.sign(n.z)).toBe(Math.sign(p.z));
      }
    });
    it('a higher exponent is boxier: more of the body lies near its corners', () => {
      const corner = (section: number) => {
        const g = buildGeometry({ type: 'extrude', contour: [[0, 0], [100, 0], [100, 100], [0, 100]], depth: 100, section });
        const pos = g.getAttribute('position');
        let best = 0;
        for (let i = 0; i < pos.count; i++) best = Math.max(best, Math.hypot(pos.getX(i), pos.getZ(i)));
        return best;
      };
      expect(corner(5)).toBeGreaterThan(corner(2));
    });
  });
});
