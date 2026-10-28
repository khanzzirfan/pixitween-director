import type { MetaClients, LlmBackend } from '@shared/ports';
import type { Storyboard } from '@shared/storyboard';
import { makeFakeMeta } from '../meta/fakes';

export const isFakeDirector = (): boolean => process.env.DIRECTOR_FAKE === '1';

export function createFakeParts(o: { delayMs?: number } = {}): {
  meta: MetaClients;
  backendFor(storyboard: Storyboard, productAssetId: string): LlmBackend;
} {
  const storyboard = {
    title: 'Morning Ritual',
    palette: ['#f5e6d3', '#3b2a20'],
    scenes: [
      {
        id: 's1',
        durationSec: 4,
        intent: 'Reveal the mug in warm sunrise light',
        shotType: 'hero',
        camera: 'dolly-in',
        layersWanted: ['bg', 'product', 'headline'],
        text: 'Slow mornings',
        mode: 'motion',
        modeReason: 'A tabletop product works with a still.',
      },
      {
        id: 's2',
        durationSec: 4,
        intent: 'Coffee pours into a mug',
        shotType: 'lifestyle',
        camera: 'static',
        layersWanted: ['bg', 'product'],
        text: '',
        mode: 'generate',
        modeReason: 'Pouring coffee needs fluid motion.',
      },
      {
        id: 's3',
        durationSec: 4,
        intent: 'Close on the mug',
        shotType: 'closer',
        camera: 'parallax',
        layersWanted: ['bg', 'product', 'headline'],
        text: 'Made for mornings',
        mode: 'motion',
        modeReason: 'A closing card works with a still.',
      },
    ],
  };
  const meta = makeFakeMeta({
    sparkScript: [
      {
        content: JSON.stringify(storyboard),
        toolCalls: [],
        usage: { promptTokens: 900, completionTokens: 1100 },
        ms: 1,
        model: 'muse-spark-1.3-contributor',
      },
    ],
  });
  return {
    meta,
    backendFor(plan, productId) {
      let n = 0;
      return {
        id: 'spark',
        async chatWithTools() {
          await new Promise((resolve) => setTimeout(resolve, o.delayMs ?? Number(process.env.DIRECTOR_FAKE_DELAY_MS ?? 400)));
          const scene = plan.scenes[n++];
          if (!scene) return { toolCalls: [], content: 'DONE', ms: 1 };
          const calls: Array<{ name: string; args: Record<string, unknown> }> = [
            { name: 'addLayer', args: { sceneId: scene.id, role: 'bg', kind: 'shape', fill: plan.palette[0] } },
            { name: 'addLayer', args: { sceneId: scene.id, role: 'product', kind: 'image', assetId: productId } },
          ];
          if (scene.text) calls.push({ name: 'addLayer', args: { sceneId: scene.id, role: 'headline', kind: 'text', text: scene.text } });
          if (scene.text)
            calls.push({
              name: 'setKeyframes',
              args: {
                layerId: `${scene.id}:headline`,
                prop: 'opacity',
                keys: [
                  [0, 0],
                  [0.6, 1],
                ],
                ease: 'easeOut',
              },
            });
          calls.push({ name: 'setCamera', args: { sceneId: scene.id, move: scene.camera } });
          return { toolCalls: calls.map((call, i) => ({ ...call, id: `${scene.id}_${i}` })), content: '', ms: 1 };
        },
      };
    },
  };
}
