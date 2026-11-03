import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildRunners, roundProfile, runnerCount, runnerState } from './runners';

const can = { top: 0.14, bottom: 0.01, seed: 3 };

describe('runners', () => {
  it('are the same for the same time and seed, so seeking gives the same frame', () => {
    expect(runnerState(2, 1.7, can)).toEqual(runnerState(2, 1.7, can));
    expect(runnerState(2, 1.7, can)).not.toEqual(runnerState(2, 1.7, { ...can, seed: 4 }));
  });
  it('never climb: a drop only holds or runs down until it is gone, then starts again higher', () => {
    let resets = 0;
    let last = runnerState(0, 0, can);
    for (let t = 0.02; t < 12; t += 0.02) {
      const d = runnerState(0, t, can);
      if (d.y > last.y + 1e-9) resets++;
      last = d;
    }
    expect(resets).toBeGreaterThan(0);
    expect(resets).toBeLessThan(6);
  });
  it('hold still a while and slide in hops: some frames do not move, some move fast', () => {
    const steps: number[] = [];
    for (let t = 0; t < 10; t += 0.04) steps.push(runnerState(1, t, can).y - runnerState(1, t + 0.04, can).y);
    const moving = steps.filter((d) => d > 1e-6 && d < 0.05);
    expect(steps.filter((d) => Math.abs(d) < 1e-9).length).toBeGreaterThan(20);
    expect(Math.max(...moving)).toBeGreaterThan(Math.min(...moving) * 5);
  });
  it('leave a trail above them while they run', () => {
    const d = Array.from({ length: 200 }, (_, k) => runnerState(4, k * 0.05, can)).find((r) => r.trailTop - r.y > 0.02);
    expect(d?.trailWidth).toBeGreaterThan(0);
  });
  it('more wetness, more drops', () => {
    expect(runnerCount(1)).toBeGreaterThan(runnerCount(0.2));
  });
  it('follow a round body and skip a box', () => {
    const cylinder = roundProfile(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 32), new THREE.Matrix4());
    expect(cylinder?.profile(0)).toBeCloseTo(0.03, 3);
    expect(cylinder!.top).toBeLessThan(0.08);
    expect(roundProfile(new THREE.BoxGeometry(0.1, 0.2, 0.02), new THREE.Matrix4())).toBeNull();
  });
  it('sit on the surface of the body', () => {
    const round = roundProfile(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 32), new THREE.Matrix4())!;
    const rig = buildRunners({ ...round, amount: 0.8 });
    rig.setTime(2);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    let placed = 0;
    for (let i = 0; i < rig.mesh.count; i += 2) {
      rig.mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      if (m.elements[0] === 0 && m.elements[5] === 0) continue;
      placed++;
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(0.03, 3);
    }
    expect(placed).toBeGreaterThan(0);
  });
});
