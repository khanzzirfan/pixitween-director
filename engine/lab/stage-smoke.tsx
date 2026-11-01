// Dev page (/motion-stage-smoke.html, not linked from the app): the whole 2D stage on Three — images,
// text, shapes and groups, built by `createNode` for every layer of `basic-2d` — so a look or colour
// problem shows up before the runtime exists. A seek slider moves through the doc setting visibility
// (`isVisible`) and opacity (`applyOpacityTree`) and rendering; clicking the canvas reads back the RGBA
// under the cursor. The real code lives here; the web/ files are stubs because Vite only serves HTML
// from its root.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { createStageCamera } from '../src/core/stage';
import { isVisible } from '../src/core/visibility';
import { parseMotionDoc } from '../src/schema/doc';
import type { MotionDoc } from '../src/schema/doc';
import type { MotionNode } from '../src/core/types';
import { createNode } from '../src/stage2d/createNode';
import { applyOpacityTree } from '../src/stage2d/opacity';
import { loadImageTextures, disposeTextures } from '../src/stage2d/textures';
import { createThreeNode } from '../src/three';
import basic2dFixture from '../fixtures/basic-2d.json';

const FIXTURES = { 'basic-2d': basic2dFixture } as const;

type FixtureName = keyof typeof FIXTURES;

const FIXTURE_NAMES = Object.keys(FIXTURES) as FixtureName[];

/** The imperative pieces the page owns: the renderer, the stage, the camera and every top-level node. */
interface Rig {
  renderer: THREE.WebGLRenderer;
  stage: THREE.Scene;
  camera: THREE.OrthographicCamera;
  doc: MotionDoc;
  nodes: MotionNode[];
  textures: Map<string, THREE.Texture>;
}

/** The runtime's renderer settings (engine/docs/06-runtime-player.md). */
function createRenderer(width: number, height: number): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.domElement.style.width = '960px';
  renderer.domElement.style.height = 'auto';
  return renderer;
}

function renderStage(rig: Pick<Rig, 'renderer' | 'stage' | 'camera'>): void {
  rig.renderer.setRenderTarget(null);
  rig.renderer.render(rig.stage, rig.camera);
}

/** Pre-order depth-first walk, assigning `renderOrder` to every mesh a node owns (not its children's —
 * group children come after their own group's meshes, since they're visited after it in this walk). */
function assignRenderOrder(nodes: MotionNode[]): void {
  let index = 0;
  const visit = (node: MotionNode): void => {
    const order = index;
    index += 1;
    for (const owned of node.content.children) {
      owned.traverse((object) => {
        if (object instanceof THREE.Mesh) object.renderOrder = order;
      });
    }
    for (const child of node.children) visit(child);
  };
  for (const node of nodes) visit(node);
}

function flattenNodes(nodes: MotionNode[]): MotionNode[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);
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

/** The RGBA under a client-space click, mapped from the canvas's CSS box to its actual pixel resolution. */
function pixelAt(renderer: THREE.WebGLRenderer, clientX: number, clientY: number): string {
  const canvas = renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  const x = Math.round(((clientX - rect.left) / rect.width) * canvas.width);
  const y = Math.round(((clientY - rect.top) / rect.height) * canvas.height);
  const gl = renderer.getContext();
  const out = new Uint8Array(4);
  // readPixels is bottom-up.
  gl.readPixels(x, canvas.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return `rgba(${out[0]}, ${out[1]}, ${out[2]}, ${out[3]}) at (${x}, ${y})`;
}

/** Two frames, so a draw that only uploaded a texture this frame is on screen before we read it. */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function StageSmoke() {
  const mount = useRef<HTMLDivElement>(null);
  const rig = useRef<Rig | null>(null);
  const [fixture, setFixture] = useState<FixtureName>('basic-2d');
  const [time, setTime] = useState(0);
  const [status, setStatus] = useState('loading…');
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [hashes, setHashes] = useState<string[]>([]);
  const [pixel, setPixel] = useState('');

  const draw = useCallback((t: number) => {
    const current = rig.current;
    if (!current) return;
    for (const node of flattenNodes(current.nodes)) {
      const visible = isVisible(t, node.start, node.end, current.doc.duration);
      node.display.visible = visible;
      if (visible) node.update?.(t, Math.round(t * current.doc.fps));
    }
    applyOpacityTree(current.nodes);
    renderStage(current);
  }, []);

  const seek = useCallback(
    async (t: number) => {
      draw(t);
      setTime(t);
      await nextFrame();
      const current = rig.current;
      if (current) {
        const nodes = flattenNodes(current.nodes);
        setErrors(nodes.flatMap((node) => ('errors' in node ? (node as { errors: string[] }).errors : [])));
        setWarnings(nodes.flatMap((node) => node.warnings));
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
      setPixel('');

      const parsed = parseMotionDoc(FIXTURES[fixture]);
      if (!parsed.ok) {
        setErrors(parsed.errors.map((error) => `${error.path}: ${error.message}`));
        setStatus('doc errors');
        return;
      }
      const doc = parsed.doc;

      const renderer = createRenderer(doc.width, doc.height);
      if (cancelled) {
        renderer.dispose();
        return;
      }
      container.appendChild(renderer.domElement);
      const stage = new THREE.Scene();
      stage.background = doc.background === 'transparent' ? null : new THREE.Color(doc.background);
      const camera = createStageCamera(doc.width, doc.height);

      const { textures, errors: textureErrors } = await loadImageTextures(doc);
      if (cancelled) {
        disposeTextures(textures);
        renderer.domElement.remove();
        renderer.dispose();
        return;
      }

      const nodes = doc.layers.map((layer) => createNode(layer, { doc, textures, renderer }, 0, { three: createThreeNode }));
      for (const node of nodes) stage.add(node.display);

      const flat = flattenNodes(nodes);
      const readyResults = await Promise.allSettled(flat.map((node) => node.ready));
      const readyErrors = readyResults
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => String(result.reason));
      // Text builds its mesh asynchronously (waits on document.fonts.load), so renderOrder can only be
      // assigned once every node's mesh exists — assigning it before `ready` leaves late meshes at the
      // THREE.Object3D default (0), drawing them under earlier, already-built layers.
      assignRenderOrder(nodes);

      if (cancelled) {
        for (const node of nodes) node.destroy();
        disposeTextures(textures);
        renderer.domElement.remove();
        renderer.dispose();
        return;
      }

      rig.current = { renderer, stage, camera, doc, nodes, textures };
      (window as unknown as { __smoke: Rig | null }).__smoke = rig.current;
      draw(0);
      setTime(0);
      setWarnings(flat.flatMap((node) => node.warnings));
      setErrors([...textureErrors.map((entry) => String(entry.error)), ...readyErrors]);
      setStatus('ready');

      cleanup = () => {
        for (const node of nodes) node.destroy();
        disposeTextures(textures);
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

  const onCanvasClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const current = rig.current;
    if (!current) return;
    setPixel(pixelAt(current.renderer, event.clientX, event.clientY));
  }, []);

  const hashAt = useCallback(
    async (t: number) => {
      await seek(t);
      return hashCanvas(rig.current?.renderer.domElement ?? null);
    },
    [seek],
  );

  const seekTwice = useCallback(async () => {
    const at = (rig.current?.doc.duration ?? 1) * 0.4;
    const first = await hashAt(at);
    await seek(0);
    const second = await hashAt(at);
    setHashes([`${at.toFixed(2)} s: ${first}`, `${at.toFixed(2)} s again: ${second}`, first === second ? 'same' : 'different']);
  }, [hashAt, seek]);

  const duration = rig.current?.doc.duration ?? 1;

  return (
    <main style={{ padding: 16, color: '#e5e7eb', background: '#0b0f19', minHeight: '100vh', fontFamily: 'monospace' }}>
      <h1>stage smoke — images, text, shapes and groups on the Three stage</h1>
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
      <div ref={mount} style={{ lineHeight: 0, cursor: 'crosshair' }} onClick={onCanvasClick} />
      <p>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.01}
          value={time}
          onChange={(event) => void seek(Number(event.target.value))}
          style={{ width: 480, verticalAlign: 'middle' }}
        />
      </p>
      <p data-testid="time">
        At {time.toFixed(2)} s of {duration.toFixed(2)} s — click the canvas to read a pixel back.
      </p>
      <p>
        <button type="button" onClick={() => void seekTwice()}>
          Seek 40%, 0, 40% and compare
        </button>
      </p>
      {pixel !== '' && <p data-testid="pixel">{pixel}</p>}
      {warnings.length > 0 && <p data-testid="warnings">{warnings.join('; ')}</p>}
      {errors.length > 0 && <p data-testid="errors">{errors.join('; ')}</p>}
      {hashes.length > 0 && <p data-testid="hashes">{hashes.join(' · ')}</p>}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StageSmoke />);
