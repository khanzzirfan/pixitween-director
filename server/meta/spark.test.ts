import { afterEach, expect, it } from 'vitest';
import { readSeedBuffer, readSeedJson } from '../test-utils/fixtures';
import { createMetaHttp } from './http';
import { SparkProtocolError, createSparkClient } from './spark';
import { sendJson, startTestServer } from './test-server';

let srv: Awaited<ReturnType<typeof startTestServer>> | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
});
const client = () => createSparkClient(createMetaHttp({ baseUrl: srv!.baseUrl, apiKey: () => 'k', retryDelayMs: 0 }), { model: 'muse-spark-1.3-contributor' });

const toolResponse = (calls: string[]) => ({
  choices: [{ message: { content: 'Building', tool_calls: calls.map((c, i) => ({ id: `call_${i}`, type: 'function', function: { name: c.slice(0, c.indexOf('(')), arguments: c.slice(c.indexOf('(') + 1, -1) } })) } }],
  usage: { prompt_tokens: 1010, completion_tokens: 1988, completion_tokens_details: { reasoning_tokens: 1324 } },
  model: 'muse-spark-1.3-contributor',
});

it('parses the seed tool turn into six calls with numeric args', async () => {
  srv = await startTestServer((_r, res) => sendJson(res, 200, toolResponse(readSeedJson('spark-tool-loop-turns.json')[0].calls)));
  const r = await client().chat({ messages: [{ role: 'user', content: 'go' }] });
  expect(r.toolCalls).toHaveLength(6);
  expect(r.toolCalls[0]).toMatchObject({ name: 'addScene', args: { durationSec: 4, id: 'scene1', intent: 'white ceramic mug warm morning scene' } });
  expect(r.usage).toEqual({ promptTokens: 1010, completionTokens: 1988, reasoningTokens: 1324 });
  expect(JSON.parse(srv.seen[0]!.body).model).toBe('muse-spark-1.3-contributor');
});

it('returns structured storyboard content', async () => {
  srv = await startTestServer((_r, res) => sendJson(res, 200, readSeedJson('spark-storyboard-response.json')));
  const r = await client().chat({ messages: [{ role: 'user', content: 'plan' }], response_format: { type: 'json_object' } });
  expect(JSON.parse(r.content!).scenes).toHaveLength(3);
});

it('rejects malformed tool arguments, naming the tool', async () => {
  srv = await startTestServer((_r, res) => sendJson(res, 200, toolResponse(['addScene({bad'])));
  await expect(client().chat({ messages: [] })).rejects.toThrow(/addScene/);
  await expect(client().chat({ messages: [] })).rejects.toBeInstanceOf(SparkProtocolError);
});

it('reviewImages sends data URLs with sniffed mimes and parses the verdict', async () => {
  srv = await startTestServer((_r, res) => sendJson(res, 200, readSeedJson('spark-vision-image-response.json')));
  const verdict = (await client().reviewImages([readSeedBuffer('cafe-with-mug.jpg')], 'check')) as { pass: boolean };
  expect(verdict.pass).toBe(false);
  const body = JSON.parse(srv.seen[0]!.body);
  expect(body.response_format).toEqual({ type: 'json_object' });
  expect(body.messages[0].content[1].image_url.url.startsWith('data:image/jpeg;base64,')).toBe(true);
  await client().reviewImages([readSeedBuffer('mug-product.png')], 'check', { type: 'object' });
  const body2 = JSON.parse(srv.seen[1]!.body);
  expect(body2.messages[0].content[1].image_url.url.startsWith('data:image/png;base64,')).toBe(true);
  expect(body2.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'review', strict: true } });
});

it('reviewImages throws on non-JSON content', async () => {
  srv = await startTestServer((_r, res) => sendJson(res, 200, { choices: [{ message: { content: 'not json' } }] }));
  await expect(client().reviewImages([readSeedBuffer('mug-product.png')], 'x')).rejects.toBeInstanceOf(SparkProtocolError);
});

it('video sends input_video and returns the text', async () => {
  srv = await startTestServer((_r, res) => sendJson(res, 200, { output: [{ content: [{ text: 'a mug on a table' }] }] }));
  expect(await client().video(Buffer.from('mp4'), 'describe')).toBe('a mug on a table');
  const body = JSON.parse(srv.seen[0]!.body);
  expect(srv.seen[0]!.url).toContain('/responses');
  expect(body.input[0].content[1]).toMatchObject({ type: 'input_video' });
  srv.seen.length = 0;
});
