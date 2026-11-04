import type { MetaClients, TranscribeResult } from '@shared/ports';
import type { MetaHttp } from './http';

interface RawTranscribe {
  transcript?: string;
  audioDurationMs?: number;
  turns?: Array<{ startMs: number; endMs: number; transcript: string; speaker?: string }>;
}

export function createTranscribeClient(http: MetaHttp): MetaClients['transcribe'] {
  return {
    async file(wav, opts): Promise<TranscribeResult> {
      const form = new FormData();
      const request = {
        mode: opts.diarize ? 'DIARIZATION' : 'PUSH_TO_TALK',
        model: 'muse-voice-transcribe-1.0',
        audioEncoding: 'WAV',
        languageBias: ['English'],
        keywords: opts.keywords ?? [],
      };
      form.set('request', new Blob([JSON.stringify(request)], { type: 'application/json' }), 'request.json');
      form.set('audio', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav');
      const r = await http.form('/asr/transcribe', form, { Accept: 'application/json' });
      const raw = JSON.parse(r.text) as RawTranscribe;
      return {
        transcript: raw.transcript ?? '',
        turns: (raw.turns ?? []).map((t) => ({
          startMs: t.startMs,
          endMs: t.endMs,
          transcript: t.transcript,
          ...(t.speaker !== undefined ? { speaker: t.speaker } : {}),
        })),
        ...(raw.audioDurationMs !== undefined ? { audioDurationMs: raw.audioDurationMs } : {}),
      };
    },
  };
}
