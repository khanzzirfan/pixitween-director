import { z } from 'zod';
import type { ToolDef } from '@shared/tools';
import { createSparkOpenBackend, SPARK_OPEN_MODEL } from '../../server/llm/spark-open-backend';
import type { LiveScript } from './run';

export const describe: LiveScript['describe'] = () =>
  `One chat edit through the app's own Spark Open backend (${SPARK_OPEN_MODEL} on Baseten), with a layer list in the prompt, to check it picks a real layer id. The key is never printed.`;

export const estimateUsd: LiveScript['estimateUsd'] = () => 0.005;

const scaleLayer: ToolDef = {
  name: 'scaleLayer',
  description: 'Scale a layer by a factor',
  params: z.object({ layerId: z.string(), factor: z.number() }),
  run: async () => ({ ok: true }),
};

export const run: LiveScript['run'] = async ({ env, log }) => {
  const backend = createSparkOpenBackend(env);
  const layers = ['s1:bg', 's1:product', 's1:headline'];
  const r = await backend.chatWithTools(
    [
      { role: 'system', content: `You edit a film. Layers: ${layers.join(', ')}. Call a tool to make the change.` },
      { role: 'user', content: 'make the headline bigger' },
    ],
    [scaleLayer],
    { parallelHint: true },
  );
  const call = r.toolCalls[0];
  log(`backend=${backend.id} ${r.ms}ms usage=${JSON.stringify(r.usage)} call=${call ? `${call.name}(${JSON.stringify(call.args)})` : 'none'}`);
  const layerId = (call?.args as { layerId?: string } | undefined)?.layerId;
  if (!call || !layerId || !layers.includes(layerId)) {
    log('FAILED: no tool call on a real layer id');
    process.exitCode = 1;
  } else log('ok');
};
