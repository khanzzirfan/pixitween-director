// Owned by S3b (PRD prd-s03b-director-agent). S2 stub: replace the body, keep the export names.
import type { Buffer } from 'node:buffer';
import { NotImplementedError } from './errors';

export async function transcribeBrief(_audio: Buffer): Promise<string> {
  throw new NotImplementedError('S3b');
}

export const STUB_OWNER = 'S3b' as const;
