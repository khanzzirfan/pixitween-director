import * as THREE from 'three';
import type { Layer, MotionDoc } from '../schema';
import { bakeDoc, type BakedCamera, type BakedDoc, type BakedLayer, type Bounds } from './bake';

// qaDoc (engine/docs/08-agent-tools.md): reads a bake and returns grouped findings — one group per
// (kind, subject), with the worst frame and a concrete hint — so an agent fixes the biggest group
// first and recompiles. Pure and deterministic: the same bake always gives the same report.
// 3D kinds (BELOW_FLOOR, FLOATING, CAMERA_INSIDE, SUBJECT_OUT) read the object boxes and camera of three layers.

export type QaKind = 'OFFSTAGE' | 'CLIPPED' | 'TINY_TEXT' | 'FAST_TEXT' | 'TEXT_OVERLAP' | 'POP' | 'NEVER_SEEN' | 'BELOW_FLOOR' | 'FLOATING' | 'CAMERA_INSIDE' | 'SUBJECT_OUT';

export interface QaLimits {
  /** A layer counts as visible above this effective opacity. */
  visibleOpacity: number;
  /** Text counts as readable above this effective opacity. */
  readableOpacity: number;
  /** Share of a text layer's area that may be cut by the stage edge. */
  clippedArea: number;
  /** Smallest text height, as a share of stage height. */
  tinyTextFrac: number;
  /** FAST_TEXT: base seconds a text layer must stay readable. */
  fastBaseSec: number;
  /** FAST_TEXT: words read per second, added on top of the base. */
  fastWordsPerSec: number;
  /** FAST_TEXT becomes a warning when readable time is within this factor of the limit. */
  fastWarnFactor: number;
  /** Share of the smaller text box that may be covered by another readable text. */
  overlapFrac: number;
  /** Position jump between two frames, as a share of the stage size. */
  popPosFrac: number;
  /** Opacity jump between two frames. */
  popOpacity: number;
  /** Metres an object may sit below or above the shadow floor before it is flagged. */
  floorTol: number;
  /** Metres of clearance added when the hint moves the camera out of a box. */
  cameraClear: number;
}

export const QA_LIMITS: QaLimits = {
  visibleOpacity: 0.05,
  readableOpacity: 0.8,
  clippedArea: 0.02,
  tinyTextFrac: 0.035,
  fastBaseSec: 0.3,
  fastWordsPerSec: 3.5,
  fastWarnFactor: 1.25,
  overlapFrac: 0.1,
  popPosFrac: 0.25,
  popOpacity: 0.5,
  floorTol: 0.02,
  cameraClear: 0.5,
};

export interface QaGroup {
  kind: QaKind;
  /** Layer id, or `idA+idB` for TEXT_OVERLAP. */
  subject: string;
  /** Frames in the group. */
  count: number;
  first: number;
  last: number;
  /** The measured value at the worst frame (units depend on the kind, named in `cause`). */
  worst: number;
  worstFrame: number;
  limit: number;
  cause: string;
  hint: string;
}

export interface QaReport {
  ok: boolean;
  groups: QaGroup[];
  warnings: QaGroup[];
}

const r1 = (n: number): number => Math.round(n * 10) / 10;
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

function flatten(layers: readonly Layer[], out: Layer[] = []): Layer[] {
  for (const layer of layers) {
    out.push(layer);
    if (layer.type === 'group') flatten(layer.children, out);
  }
  return out;
}

interface Hit {
  frame: number;
  value: number;
}

/** Builds one group from per-frame hits; `worstIsMax` picks the extreme direction. */
function group(
  kind: QaKind,
  subject: string,
  hits: Hit[],
  worstIsMax: boolean,
  limit: number,
  cause: (worst: Hit) => string,
  hint: (worst: Hit) => string,
): QaGroup {
  let worst = hits[0];
  for (const h of hits) if (worstIsMax ? h.value > worst.value : h.value < worst.value) worst = h;
  return {
    kind,
    subject,
    count: hits.length,
    first: hits[0].frame,
    last: hits[hits.length - 1].frame,
    worst: r3(worst.value),
    worstFrame: worst.frame,
    limit: r3(limit),
    cause: cause(worst),
    hint: hint(worst),
  };
}

function overlapArea(a: Bounds, b: Bounds): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Offsets (doc px) that bring `b` fully inside the stage; centres it when it is bigger than the stage. */
function bringInside(b: Bounds, width: number, height: number): { dx: number; dy: number } {
  const fit = (pos: number, size: number, stage: number): number =>
    size >= stage ? (stage - size) / 2 - pos : Math.min(Math.max(pos, 0), stage - size) - pos;
  return { dx: fit(b.x, b.width, width), dy: fit(b.y, b.height, height) };
}

function tweenHint(layer: Layer, frame: number, fps: number, props: string[]): string {
  const index = layer.tweens.findIndex(
    (t) => Math.abs(t.at * fps + layer.start * fps - frame) <= 1.5 && props.some((p) => p in t.to || (t.from && p in t.from)),
  );
  if (index >= 0) return `tweens[${index}] (at ${layer.tweens[index].at}s)`;
  return 'its enter/exit/loop preset or a tween';
}


// Tweened position or rotation moves an object's lowest point on purpose, so FLOATING skips it.
const isMotionProp = (k: string): boolean => /^(position|rotation)(\.|$)/.test(k);

function threeChecks(layer: Extract<Layer, { type: 'three' }>, baked: BakedLayer, lim: QaLimits, out: QaGroup[]): void {
  const floor = layer.shadow.y;
  const aspect = layer.width && layer.height ? layer.width / layer.height : 1;
  const live = baked.frames.filter((f) => f.visible && f.objects);
  const castIds = new Set(layer.objects.filter((o) => o.castShadow).map((o) => o.id));
  const movesY = new Set<string>();
  for (const t of layer.tweens) {
    const target = t.target ?? '';
    if (target.startsWith('object:') && [...Object.keys(t.to), ...Object.keys(t.from ?? {})].some(isMotionProp))
      movesY.add(target.slice(7));
  }

  // BELOW_FLOOR / FLOATING, one group per object
  for (const obj of layer.objects) {
    const below: Hit[] = [];
    const floating: Hit[] = [];
    for (const f of live) {
      const box = f.objects?.[obj.id];
      if (!box) continue;
      if (box.min[1] < floor - lim.floorTol) below.push({ frame: f.frame, value: floor - box.min[1] });
      else if (layer.shadow.enabled && castIds.has(obj.id) && !movesY.has(obj.id) && box.min[1] > floor + lim.floorTol)
        floating.push({ frame: f.frame, value: box.min[1] - floor });
    }
    const subject = `${baked.id}/${obj.id}`;
    if (below.length)
      out.push(
        group(
          'BELOW_FLOOR',
          subject,
          below,
          true,
          lim.floorTol,
          (w) => `object "${obj.id}" sinks ${r3(w.value)} m below the floor (shadow.y ${floor}) at frame ${w.frame}`,
          (w) => `add ${r3(w.value)} to its position.y (now ${obj.position[1]}) so its bottom rests on y ${floor}`,
        ),
      );
    if (floating.length)
      out.push(
        group(
          'FLOATING',
          subject,
          floating,
          true,
          lim.floorTol,
          (w) => `object "${obj.id}" floats ${r3(w.value)} m above the floor (shadow.y ${floor}) at frame ${w.frame}`,
          (w) => `subtract ${r3(w.value)} from its position.y (now ${obj.position[1]}), or tween position.y if it should fly`,
        ),
      );
  }

  // CAMERA_INSIDE
  const inside = new Map<string, Hit[]>();
  const boxes = new Map<string, { frame: number; min: number[]; max: number[] }>();
  for (const f of live) {
    const cam = f.camera?.position;
    if (!cam) continue;
    for (const [id, box] of Object.entries(f.objects ?? {})) {
      if (cam.every((c, i) => c > box.min[i] && c < box.max[i])) {
        const depth = Math.min(...cam.map((c, i) => Math.min(c - box.min[i], box.max[i] - c)));
        (inside.get(id) ?? inside.set(id, []).get(id)!).push({ frame: f.frame, value: depth });
        boxes.set(id, { frame: f.frame, min: box.min, max: box.max });
      }
    }
  }
  for (const [id, hits] of inside) {
    const b = boxes.get(id)!;
    const camZ = (live.find((f) => f.frame === b.frame)?.camera as BakedCamera).position[2];
    const clearZ = r3(camZ >= (b.min[2] + b.max[2]) / 2 ? b.max[2] + lim.cameraClear : b.min[2] - lim.cameraClear);
    out.push(
      group(
        'CAMERA_INSIDE',
        `${baked.id}/${id}`,
        hits,
        true,
        0,
        (w) => `camera is ${r3(w.value)} m inside the box of object "${id}" at frame ${w.frame}`,
        () => `set camera position.z to ${clearZ} (now ${r3(camZ)}) to clear "${id}"`,
      ),
    );
  }

  // SUBJECT_OUT: objects exist but none intersects the view
  const out3: Hit[] = [];
  for (const f of live) {
    const entries = Object.values(f.objects ?? {});
    if (!f.camera || !entries.length) continue;
    const cam = new THREE.PerspectiveCamera(f.camera.fov, aspect, 0.1, 1000);
    cam.position.set(...f.camera.position);
    cam.lookAt(new THREE.Vector3(...f.camera.lookAt));
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const anyIn = entries.some((b) => frustum.intersectsBox(new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max))));
    if (anyIn) continue;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const centres = entries.map((b) => new THREE.Vector3(...b.min).add(new THREE.Vector3(...b.max)).multiplyScalar(0.5));
    const worstAngle = Math.min(...centres.map((c) => (dir.angleTo(c.sub(cam.position)) * 180) / Math.PI));
    out3.push({ frame: f.frame, value: worstAngle });
  }
  if (out3.length)
    out.push(
      group(
        'SUBJECT_OUT',
        baked.id,
        out3,
        true,
        0,
        (w) => `no object of "${baked.id}" is in view at frame ${w.frame}; the nearest is ${r1(w.value)} deg off the camera axis`,
        () => `aim camera.lookAt at an object (or add a camera path) or use frameShot to frame a subject`,
      ),
    );
}

export function qaDoc(doc: MotionDoc, bake: BakedDoc = bakeDoc(doc), limits: Partial<QaLimits> = {}): QaReport {
  const lim: QaLimits = { ...QA_LIMITS, ...limits };
  const byId = new Map(flatten(doc.layers).map((l) => [l.id, l] as const));
  const stageW = bake.width;
  const stageH = bake.height;
  const fps = bake.fps;
  const groups: QaGroup[] = [];
  const warnings: QaGroup[] = [];

  const texts: Array<{ baked: BakedLayer; layer: Extract<Layer, { type: 'text' }> }> = [];

  for (const baked of bake.layers) {
    const layer = byId.get(baked.id);
    if (!layer || layer.type === 'group') continue;
    if (layer.type === 'three') threeChecks(layer, baked, lim, groups);
    const isText = layer.type === 'text';
    if (layer.type === 'text') texts.push({ baked, layer });

    // NEVER_SEEN
    const seen = baked.frames.some((f) => f.visible && f.opacity > lim.visibleOpacity);
    if (!seen) {
      const everVisible = baked.frames.some((f) => f.visible);
      const reason = !everVisible
        ? `its time window [${baked.start}s, ${baked.end}s) is outside the doc or empty`
        : `its opacity stays at or below ${lim.visibleOpacity}`;
      groups.push({
        kind: 'NEVER_SEEN',
        subject: baked.id,
        count: baked.frames.length,
        first: 0,
        last: baked.frames.length - 1,
        worst: Math.max(0, ...baked.frames.map((f) => f.opacity)),
        worstFrame: 0,
        limit: lim.visibleOpacity,
        cause: `layer "${baked.id}" is never visible: ${reason}`,
        hint: everVisible
          ? `raise alpha (now ${layer.alpha}) or remove the tween/preset that keeps opacity at 0`
          : `set start/end so the window sits inside 0..${bake.duration}s`,
      });
      continue;
    }

    const live = baked.frames.filter((f) => f.visible && f.opacity > lim.visibleOpacity);

    // OFFSTAGE / CLIPPED
    const off: Hit[] = [];
    const clipped: Array<Hit & { side: string; px: number }> = [];
    for (const f of live) {
      const b = f.bounds;
      if (!b || b.width <= 0 || b.height <= 0) continue;
      const iw = Math.min(b.x + b.width, stageW) - Math.max(b.x, 0);
      const ih = Math.min(b.y + b.height, stageH) - Math.max(b.y, 0);
      if (iw <= 0 || ih <= 0) {
        const gapX = Math.max(0, -(b.x + b.width), b.x - stageW);
        const gapY = Math.max(0, -(b.y + b.height), b.y - stageH);
        off.push({ frame: f.frame, value: Math.max(gapX, gapY) });
      } else if (isText) {
        const cut = 1 - (iw * ih) / (b.width * b.height);
        if (cut > lim.clippedArea) {
          const sides: Array<[string, number]> = [
            ['left', -b.x],
            ['right', b.x + b.width - stageW],
            ['top', -b.y],
            ['bottom', b.y + b.height - stageH],
          ];
          const [side, px] = sides.reduce((a, c) => (c[1] > a[1] ? c : a));
          clipped.push({ frame: f.frame, value: cut, side, px });
        }
      }
    }
    if (off.length) {
      const frames = off.map((h) => h.frame);
      const worstHit = off.reduce((a, c) => (c.value > a.value ? c : a));
      const wb = baked.frames[worstHit.frame].bounds as Bounds;
      const { dx, dy } = bringInside(wb, stageW, stageH);
      const parts: string[] = [];
      if (dx !== 0) parts.push(`x ${r1(layer.x + dx)} (now ${layer.x})`);
      if (dy !== 0) parts.push(`y ${r1(layer.y + dy)} (now ${layer.y})`);
      groups.push(
        group(
          'OFFSTAGE',
          baked.id,
          frames.map((frame) => off.find((h) => h.frame === frame) as Hit),
          true,
          0,
          (w) => `layer "${baked.id}" is fully outside the ${stageW}x${stageH} stage by ${r1(w.value)} px at frame ${w.frame}`,
          () => `move it back on stage: set ${parts.join(', ')}; if it is tweened, fix the tween 'to' value instead`,
        ),
      );
    }
    if (clipped.length) {
      const worstHit = clipped.reduce((a, c) => (c.value > a.value ? c : a));
      groups.push(
        group(
          'CLIPPED',
          baked.id,
          clipped,
          true,
          lim.clippedArea,
          (w) => `${r1(w.value * 100)}% of text "${baked.id}" is cut by the stage edge at frame ${w.frame}`,
          () => `${worstHit.side} edge cuts it: move it ${Math.ceil(worstHit.px)} px away from the ${worstHit.side} edge or shrink it`,
        ),
      );
    }

    // POP
    if (live.length) {
      const pops: Array<Hit & { kind: 'position' | 'opacity' }> = [];
      for (let i = 1; i < baked.frames.length; i++) {
        const a = baked.frames[i - 1];
        const b = baked.frames[i];
        if (!a.visible || !b.visible) continue;
        const dOp = Math.abs(b.opacity - a.opacity);
        if (dOp > lim.popOpacity) pops.push({ frame: b.frame, value: dOp, kind: 'opacity' });
        if (a.bounds && b.bounds) {
          const dx = Math.abs(b.bounds.x + b.bounds.width / 2 - (a.bounds.x + a.bounds.width / 2)) / stageW;
          const dy = Math.abs(b.bounds.y + b.bounds.height / 2 - (a.bounds.y + a.bounds.height / 2)) / stageH;
          const d = Math.max(dx, dy);
          if (d > lim.popPosFrac) pops.push({ frame: b.frame, value: d, kind: 'position' });
        }
      }
      if (pops.length) {
        const w = pops.reduce((a, c) => (c.value > a.value ? c : a));
        const props = w.kind === 'position' ? ['x', 'y', 'scale', 'scaleX', 'scaleY'] : ['alpha', 'opacity'];
        const limit = w.kind === 'position' ? lim.popPosFrac : lim.popOpacity;
        groups.push(
          group(
            'POP',
            baked.id,
            pops,
            true,
            limit,
            (x) =>
              `layer "${baked.id}" jumps ${w.kind} by ${r3(x.value)}${w.kind === 'position' ? ' of the stage' : ''} in one frame at frame ${x.frame}`,
            (x) =>
              `${tweenHint(layer, x.frame, fps, props)} causes the jump at frame ${x.frame}: give it a duration of at least ${r3(Math.ceil(x.value / limit) / fps)}s with an ease`,
          ),
        );
      }
    }

    // TINY_TEXT / FAST_TEXT
    if (layer.type === 'text') {
      const limitPx = lim.tinyTextFrac * stageH;
      const tiny: Hit[] = [];
      for (const f of live) if (f.fontPx !== undefined && f.fontPx < limitPx) tiny.push({ frame: f.frame, value: f.fontPx });
      if (tiny.length) {
        const w = tiny.reduce((a, c) => (c.value < a.value ? c : a));
        const worldScale = w.value / layer.style.fontSize;
        const layerScale = typeof layer.scale === 'number' ? layer.scale : layer.scale[1];
        const needScale = r1(Math.ceil((layerScale * limitPx * 10) / w.value) / 10);
        const needFont = Math.ceil(limitPx / (worldScale || 1));
        groups.push(
          group(
            'TINY_TEXT',
            baked.id,
            tiny,
            false,
            limitPx,
            (x) => `text "${baked.id}" renders at ${r1(x.value)} px, below ${r1(limitPx)} px (${r1(lim.tinyTextFrac * 100)}% of ${stageH}) at frame ${x.frame}`,
            () => `set style.fontSize to ${needFont} (now ${layer.style.fontSize}) or scale to ${needScale} (now ${layerScale})`,
          ),
        );
      }

      let run = 0;
      let best = 0;
      for (const f of baked.frames) {
        run = f.visible && f.opacity > lim.readableOpacity ? run + 1 : 0;
        best = Math.max(best, run);
      }
      const readable = best / fps;
      const need = lim.fastBaseSec + wordCount(layer.text) / lim.fastWordsPerSec;
      if (readable < need * lim.fastWarnFactor) {
        const hit: Hit[] = [{ frame: live[0].frame, value: readable }];
        const g = group(
          'FAST_TEXT',
          baked.id,
          hit,
          false,
          need,
          (x) => `text "${baked.id}" is readable for ${r3(x.value)}s, needs ${r3(need)}s for ${wordCount(layer.text)} words`,
          (x) => `add ${r1(Math.max(0.1, need - x.value))}s to end, or shorten enter/exit so it stays above ${lim.readableOpacity} opacity longer`,
        );
        g.count = best;
        (readable < need ? groups : warnings).push(g);
      }
    }
  }

  // TEXT_OVERLAP
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i];
      const b = texts[j];
      const hits: Hit[] = [];
      for (let f = 0; f < bake.frameCount; f++) {
        const fa = a.baked.frames[f];
        const fb = b.baked.frames[f];
        if (!fa?.bounds || !fb?.bounds) continue;
        if (fa.opacity <= lim.readableOpacity || fb.opacity <= lim.readableOpacity) continue;
        const smaller = Math.min(fa.bounds.width * fa.bounds.height, fb.bounds.width * fb.bounds.height);
        if (smaller <= 0) continue;
        const frac = overlapArea(fa.bounds, fb.bounds) / smaller;
        if (frac > lim.overlapFrac) hits.push({ frame: f, value: frac });
      }
      if (hits.length) {
        groups.push(
          group(
            'TEXT_OVERLAP',
            `${a.baked.id}+${b.baked.id}`,
            hits,
            true,
            lim.overlapFrac,
            (x) => `texts "${a.baked.id}" and "${b.baked.id}" overlap by ${r1(x.value * 100)}% of the smaller at frame ${x.frame}`,
            (x) =>
              `at frame ${x.frame} move "${b.baked.id}" down by about ${Math.ceil(
                (a.baked.frames[x.frame].bounds as Bounds).y + (a.baked.frames[x.frame].bounds as Bounds).height - (b.baked.frames[x.frame].bounds as Bounds).y,
              )} px, or stagger their start/end so only one is readable at a time`,
          ),
        );
      }
    }
  }

  const rank = (g: QaGroup): number => g.count;
  groups.sort((a, b) => rank(b) - rank(a) || a.kind.localeCompare(b.kind) || a.subject.localeCompare(b.subject));
  return { ok: groups.length === 0, groups, warnings };
}
