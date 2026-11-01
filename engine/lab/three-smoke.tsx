// Dev page (/motion-three-smoke.html, not linked from the app): one ThreeNode on the Three-only stage (one
// WebGLRenderer, an orthographic stage camera in pixels), tweened with a plain GSAP timeline, so a WebGL problem
// shows up before the runtime exists. It draws the first `three` layer
// of a fixture, lets you seek the hand-written timeline, and hashes the canvas so two seeks to one time can be
// compared. The real code lives here; the web/ files are stubs because Vite only serves HTML from its root.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { gsap } from 'gsap';
import * as THREE from 'three';
import { createStageCamera } from '../src/core/stage';
import { parseMotionDoc } from '../src/schema/doc';
import { createThreeNode, type ThreeNode } from '../src/three';
import type { TargetRef } from '../src/core/paths';
import type { ThreeLayer } from '../src/schema/layer3d';
import gltfFixture from '../fixtures/three-gltf.json';
import primitivesFixture from '../fixtures/three-primitives.json';
import postfxFixture from '../fixtures/three-postfx.json';

const FIXTURES = {
  'three-gltf': gltfFixture,
  'three-primitives': primitivesFixture,
  'three-postfx': postfxFixture,
} as const;

type FixtureName = keyof typeof FIXTURES;

const FIXTURE_NAMES = Object.keys(FIXTURES) as FixtureName[];

const DEG_TO_RAD = Math.PI / 180;

/** The imperative pieces the page owns: the renderer, the stage, the ThreeNode and the page's own timeline. */
interface Rig {
  renderer: THREE.WebGLRenderer;
  stage: THREE.Scene;
  camera: THREE.OrthographicCamera;
  node: ThreeNode;
  timeline: gsap.core.Timeline;
}

const STAGE_BACKGROUND = '#224466';

/** The runtime's renderer settings (engine/docs/06-runtime-player.md). */
function createRenderer(width: number, height: number): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.width = '960px';
  renderer.domElement.style.height = 'auto';
  return renderer;
}

function renderStage(rig: Pick<Rig, 'renderer' | 'stage' | 'camera'>): void {
  rig.renderer.setRenderTarget(null);
  rig.renderer.render(rig.stage, rig.camera);
}

/** SHA-256 (first 12 hex chars) of a 64x36 downscale of the canvas, so two seeks to one time can be compared. */
async function hashCanvas(canvas: HTMLCanvasElement | null): Promise<string> {
  if (!canvas) return 'no canvas';
  const small = document.createElement('canvas');
  small.width = 64;
  small.height = 36;
  const ctx = small.getContext('2d');
  if (!ctx) return 'no 2d';
  ctx.drawImage(canvas, 0, 0, 64, 36);
  const digest = await crypto.subtle.digest('SHA-256', ctx.getImageData(0, 0, 64, 36).data);
  return [...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The RGBA of the final canvas pixel 5 px inside the layer's top-left corner (the transparency check). */
function cornerPixel(rig: Rig): string {
  const { renderer, node } = rig;
  const layer = node.layer;
  const size = node.size();
  const x = Math.round(layer.x - layer.anchor[0] * size.width + 5);
  const y = Math.round(layer.y - layer.anchor[1] * size.height + 5);
  const gl = renderer.getContext();
  const out = new Uint8Array(4);
  // readPixels is bottom-up.
  gl.readPixels(x, renderer.domElement.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return `rgba(${out[0]}, ${out[1]}, ${out[2]}, ${out[3]}) at (${x}, ${y})`;
}

/** Two frames, so a draw that only uploaded the sprite texture this frame is on screen before we read it. */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** A fromTo onto a resolveTarget ref; degrees in, radians stored, exactly like the tween compiler. */
function addTween(timeline: gsap.core.Timeline, ref: TargetRef, from: number, to: number, duration: number): void {
  const convert = (value: number): number => (ref.kind === 'deg' ? value * DEG_TO_RAD : value);
  timeline.fromTo(
    ref.obj,
    { [ref.key]: convert(from) },
    { [ref.key]: convert(to), duration, ease: 'none', immediateRender: false },
  );
}

/** The page's own timeline: the camera dollies in and the first object turns, both pure functions of time. */
function buildTimeline(node: ThreeNode, layer: ThreeLayer, duration: number): gsap.core.Timeline {
  const timeline = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
  // Pin the length so the slider maps onto the whole layer whatever the tweens reach.
  timeline.set({}, {}, duration);

  const camera = node.resolveTarget('camera', 'position.z');
  if (camera) addTween(timeline, camera, layer.camera.position[2], layer.camera.position[2] - 1.6, duration);

  const first = layer.objects[0];
  const object = node.resolveTarget(`object:${first.id}`, 'rotation.y');
  if (object) addTween(timeline, object, first.rotation[1], first.rotation[1] + 360, duration);

  // Record every start value, then park on 0 so the first frame is the fixture's own pose.
  timeline.progress(1, true).progress(0, true);
  timeline.seek(0, true);
  return timeline;
}

/** Draw until the node's rig exists and its first frame lands; a glTF layer builds its rig asynchronously. */
async function waitForReady(node: ThreeNode, rig: Pick<Rig, 'renderer' | 'stage' | 'camera'>): Promise<string | null> {
  let failure: unknown = null;
  const settled = node.ready.then(
    () => 'ready' as const,
    (error) => {
      failure = error;
      return 'error' as const;
    },
  );
  for (let i = 0; i < 1200; i += 1) {
    node.update?.(0, 0);
    renderStage(rig);
    const result = await Promise.race([
      settled,
      new Promise<'tick'>((resolve) => requestAnimationFrame(() => resolve('tick'))),
    ]);
    if (result === 'ready') return null;
    if (result === 'error') return String(failure);
  }
  return 'timed out waiting for the three layer to draw';
}

function ThreeSmoke() {
  const mount = useRef<HTMLDivElement>(null);
  const rig = useRef<Rig | null>(null);
  const [fixture, setFixture] = useState<FixtureName>('three-gltf');
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState('loading…');
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [hashes, setHashes] = useState<string[]>([]);
  const [corner, setCorner] = useState('');

  const draw = useCallback((t: number) => {
    const current = rig.current;
    if (!current) return;
    current.timeline.seek(t, true);
    current.node.update?.(t, Math.round(t * 30));
    renderStage(current);
  }, []);

  const seek = useCallback(
    async (t: number) => {
      draw(t);
      setTime(t);
      await nextFrame();
      const current = rig.current;
      if (current) {
        setErrors([...current.node.errors]);
        setWarnings([...current.node.warnings]);
        setCorner(cornerPixel(current));
      }
    },
    [draw],
  );

  useEffect(() => {
    const container = mount.current;
    if (!container) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      setStatus('loading…');
      setErrors([]);
      setWarnings([]);
      setHashes([]);
      setCorner('');

      const parsed = parseMotionDoc(FIXTURES[fixture]);
      if (!parsed.ok) {
        setErrors(parsed.errors.map((error) => `${error.path}: ${error.message}`));
        setStatus('doc errors');
        return;
      }
      const doc = parsed.doc;
      const layer = doc.layers.find((candidate) => candidate.type === 'three');
      if (!layer || layer.type !== 'three') {
        setErrors(['this fixture has no three layer']);
        setStatus('no layer');
        return;
      }

      const renderer = createRenderer(doc.width, doc.height);
      if (cancelled) {
        renderer.dispose();
        return;
      }
      container.appendChild(renderer.domElement);
      const stage = new THREE.Scene();
      stage.background = new THREE.Color(STAGE_BACKGROUND);
      const camera = createStageCamera(doc.width, doc.height);
      const view = { renderer, stage, camera };

      const node = createThreeNode(layer, { doc, textures: new Map(), renderer }, 0) as ThreeNode;
      stage.add(node.display);

      const failure = await waitForReady(node, view);
      if (cancelled) {
        node.destroy();
        renderer.domElement.remove();
        renderer.dispose();
        return;
      }

      const timeline = buildTimeline(node, layer, (layer.end ?? doc.duration) - layer.start);
      rig.current = { renderer, stage, camera, node, timeline };
      (window as unknown as { __smoke: Rig | null }).__smoke = rig.current;
      setDuration((layer.end ?? doc.duration) - layer.start);
      draw(0);
      setTime(0);
      setWarnings([...node.warnings]);
      setErrors(failure ? [...node.errors, failure] : [...node.errors]);
      setStatus(failure ? 'error' : 'ready');

      cleanup = () => {
        timeline.kill();
        node.destroy();
        renderer.domElement.remove();
        renderer.dispose();
        rig.current = null;
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [fixture, draw]);

  const hashAt = useCallback(
    async (t: number) => {
      await seek(t);
      return hashCanvas(rig.current?.renderer.domElement ?? null);
    },
    [seek],
  );

  const seekTwice = useCallback(async () => {
    const at = 2;
    const first = await hashAt(at);
    await seek(0);
    const second = await hashAt(at);
    setHashes([`${at.toFixed(1)} s: ${first}`, `${at.toFixed(1)} s again: ${second}`, first === second ? 'same' : 'different']);
  }, [hashAt, seek]);

  return (
    <main style={{ padding: 16, color: '#e5e7eb', background: '#0b0f19', minHeight: '100vh', fontFamily: 'monospace' }}>
      <h1>three smoke — one ThreeNode, tweened with GSAP</h1>
      <p>
        Fixture{' '}
        <select value={fixture} onChange={(event) => setFixture(event.target.value as FixtureName)}>
          {FIXTURE_NAMES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>{' '}
        <span data-testid="status">{status}</span>
      </p>
      <div ref={mount} style={{ lineHeight: 0 }} />
      <p>
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.01}
          value={time}
          onChange={(event) => void seek(Number(event.target.value))}
          style={{ width: 480, verticalAlign: 'middle' }}
        />
      </p>
      <p>
        {[0.5, 1.5, 2].map((t) => (
          <button key={t} type="button" onClick={() => void seek(t)} style={{ marginRight: 8 }}>
            Seek {t.toFixed(1)} s
          </button>
        ))}
        <button type="button" onClick={() => void seekTwice()}>
          Seek 2.0, 0, 2.0 and compare
        </button>
      </p>
      <p data-testid="time">
        At {time.toFixed(2)} s of {duration.toFixed(2)} s
      </p>
      {corner !== '' && <p data-testid="corner">pixel (2, 2): {corner}</p>}
      {warnings.length > 0 && <p data-testid="warnings">{warnings.join('; ')}</p>}
      {errors.length > 0 && <p data-testid="errors">{errors.join('; ')}</p>}
      {hashes.length > 0 && <p data-testid="hashes">{hashes.join(' · ')}</p>}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<ThreeSmoke />);
