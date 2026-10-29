// Dev page (/clip-check.html, not linked from the app): does a video layer inside a later scene start at that scene's start?
import { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import { addLayer, addScene, newFilmComposition, registerAsset } from '../../../server/authoring/api';
import { swapInClip } from '../../../server/generate/swap';
import Player, { type PlayerHandle } from '../player/Player';
import '../styles.css';

const CLIP = { id: 'ast_00000000000000000000000000000c10', url: '/dev/clip-testsrc.mp4' };
const PRODUCT = 'ast_0123456789abcdef0123456789abcdef';
const SCENE2_START = 3;

function build(): AepCompositionJson {
  let c = newFilmComposition({ aspect: '16:9', title: 'Clip check', palette: ['#111827'] });
  c = registerAsset(c, { id: PRODUCT, kind: 'image', src: '/dev/product.png', width: 384, height: 672 });
  c = addScene(c, { id: 's1', durationSec: 3, mode: 'motion' });
  c = addLayer(c, { sceneId: 's1', role: 'bg', kind: 'shape', fill: '#1f2937' });
  c = addLayer(c, { sceneId: 's1', role: 'headline', kind: 'text', text: 'Scene one' });
  c = addScene(c, { id: 's2', durationSec: 4, mode: 'generate' });
  c = addLayer(c, { sceneId: 's2', role: 'bg', kind: 'shape', fill: '#7c2d12' });
  c = addLayer(c, { sceneId: 's2', role: 'product', kind: 'image', assetId: PRODUCT });
  c = addLayer(c, { sceneId: 's2', role: 'headline', kind: 'text', text: 'Headline above the clip' });
  // ?noclip=1 leaves scene 2 as a plain motion scene, to tell a clip problem from a page problem
  if (new URLSearchParams(window.location.search).get('noclip') === '1') return c;
  const swapped = swapInClip(c, { sceneId: 's2', asset: CLIP, clipSec: 4, frame: { width: c.width, height: c.height }, clipSize: { width: 320, height: 180 } }) as AepCompositionJson;
  // ?muted=1: the authoring core adds video layers with muted false, which a browser may refuse to autoplay
  if (new URLSearchParams(window.location.search).get('muted') === '1') {
    const layer = (swapped.precomps as Record<string, { layers: Array<Record<string, unknown>> }>).s2!.layers.find((l) => l.id === 's2:clip')!;
    layer.muted = true;
  }
  return swapped;
}

function ClipCheck() {
  const comp = useMemo(build, []);
  const player = useRef<PlayerHandle>(null);
  const [time, setTime] = useState(0);
  const seek = (sec: number) => {
    player.current?.seek(sec);
    setTime(sec);
  };
  return (
    <main style={{ padding: 16, color: '#e5e7eb', background: '#0b0f19', minHeight: '100vh' }}>
      <h1>Clip alignment check</h1>
      <p>Scene 2 starts at {SCENE2_START} s. The clip shows a burned-in timestamp; half a second into scene 2 it should read about 0.5.</p>
      <Player ref={player} composition={comp} assetMap={{ [CLIP.id]: { src: CLIP.url } }} onError={(e) => console.error('player error', e)} />
      <button type="button" onClick={() => seek(SCENE2_START + 0.5)}>Seek to scene 2 + 0.5 s</button>
      <p data-testid="readout">Seeked to {time.toFixed(2)} s</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<ClipCheck />);
