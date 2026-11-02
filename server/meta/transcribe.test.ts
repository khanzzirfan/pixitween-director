import { afterEach, expect, it } from 'vitest';
import { readSeedBuffer, readSeedJson } from '../test-utils/fixtures';
import { createMetaHttp } from './http';
import { parseForm, sendJson, startTestServer } from './test-server';
import { createTranscribeClient } from './transcribe';

let srv: Awaited<ReturnType<typeof startTestServer>> | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
});
const client = () => createTranscribeClient(createMetaHttp({ baseUrl: srv!.baseUrl, apiKey: () => 'k', retryDelayMs: 0 }));
const wav = readSeedBuffer('brief-16k.wav');

it('sends the verified multipart request', async () => {
  srv = await startTestServer((_r, res) => sendJson(res, 200, readSeedJson('transcribe-brief-response.json')));
  await client().file(wav, { keywords: ['cold brew'] });
  expect(srv.seen[0]!.url).toContain('/asr/transcribe');
  expect(srv.seen[0]!.headers.accept).toBe('application/json');
  const form = await parseForm(srv.seen[0]!);
  const req = form.get('request') as File;
  expect(req.type).toBe('application/json');
  expect(JSON.parse(await req.text())).toEqual({
    mode: 'PUSH_TO_TALK', model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', languageBias: ['English'], keywords: ['cold brew'],
  });
  const audio = form.get('audio') as File;
  expect(audio.type).toBe('audio/wav');
  expect(audio.name).toBe('audio.wav');
  expect(audio.size).toBe(wav.length);
});

it('maps the brief seed, keeping doubled words', async () => {
  srv = await startTestServer((_r, res) => sendJson(res, 200, readSeedJson('transcribe-brief-response.json')));
  const r = await client().file(wav, {});
  expect(r.transcript.startsWith("it's our our new cold brew")).toBe(true);
  expect(r.turns).toEqual([]);
});

it('maps the diarization seed and sets DIARIZATION mode', async () => {
  srv = await startTestServer((_r, res) => sendJson(res, 200, readSeedJson('transcribe-film-diarization-response.json')));
  const r = await client().file(wav, { diarize: true });
  expect(r.turns).toEqual([expect.objectContaining({ startMs: 1660, endMs: 14140, speaker: 'A' })]);
  expect(r.audioDurationMs).toBe(15120);
  expect(JSON.parse(await ((await parseForm(srv.seen[0]!)).get('request') as File).text()).mode).toBe('DIARIZATION');
});
