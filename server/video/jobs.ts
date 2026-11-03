// A reel job remembers which session started it, not the API key. Polling loads the key again from that session.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VideoProvider } from '@shared/api';
import type { FalHandle } from '../fal/client';
import type { HiggsfieldHandle } from '../higgsfield/client';

const ID = /^vid_[a-f0-9]{24}$/;

export interface VideoJob {
  id: string;
  provider: VideoProvider;
  sessionId: string;
  ipHash: string;
  createdAt: string;
  fal?: FalHandle;
  higgsfield?: HiggsfieldHandle;
  revana?: { generationId: string };
}

function pathFor(dataDir: string, id: string): string | undefined {
  if (!ID.test(id)) return undefined;
  return join(dataDir, 'video-jobs', `${id}.json`);
}

export function createJobId(): string {
  return `vid_${randomBytes(12).toString('hex')}`;
}

export function writeJob(dataDir: string, job: VideoJob): void {
  const path = pathFor(dataDir, job.id);
  if (!path) return;
  mkdirSync(join(dataDir, 'video-jobs'), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(job), { mode: 0o600 });
}

export function readJob(dataDir: string, id: string): VideoJob | undefined {
  const path = pathFor(dataDir, id);
  if (!path) return undefined;
  try {
    const job = JSON.parse(readFileSync(path, 'utf8')) as VideoJob;
    if (!job || job.id !== id || !job.sessionId || !job.ipHash) return undefined;
    return job;
  } catch {
    return undefined;
  }
}
