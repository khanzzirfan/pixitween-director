import { readFileSync } from 'node:fs';
import { createMetaClients } from '../../server/meta';
import type { LiveScript } from './run';

export const describe: LiveScript['describe'] = () =>
  'One call per Meta client: spark.chat, image.generate (1024x1024), sam.segmentImage on fixtures/seed/mug-product.png, transcribe.file on fixtures/seed/brief-16k.wav';

export const estimateUsd: LiveScript['estimateUsd'] = () => 0.03;

export const run: LiveScript['run'] = async ({ env, log }) => {
  const meta = createMetaClients(env);
  const seed = (name: string) => readFileSync(new URL(`../../fixtures/seed/${name}`, import.meta.url));
  const calls: Array<[string, () => Promise<unknown>]> = [
    ['spark.chat', () => meta.spark.chat({ messages: [{ role: 'user', content: 'Reply with the single word: ready' }] })],
    ['image.generate', () => meta.image.generate('a plain white ceramic mug on a wooden table, soft morning light', '1024x1024')],
    ['sam.segmentImage', () => meta.sam.segmentImage(seed('mug-product.png'), 'mug')],
    ['transcribe.file', () => meta.transcribe.file(seed('brief-16k.wav'), {})],
  ];
  for (const [name, call] of calls) {
    const t0 = Date.now();
    try {
      await call();
      log(`${name} ok ${Date.now() - t0}ms`);
    } catch (e) {
      const status = (e as { status?: number }).status;
      log(`${name} FAILED ${status !== undefined ? `status ${status}` : (e as Error).message} ${Date.now() - t0}ms`);
    }
  }
};

