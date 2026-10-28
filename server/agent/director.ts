// Owned by S3b (PRD prd-s03b-director-agent). S2 stub: replace the body, keep the export names.
import { NotImplementedError } from '../errors';

export async function runDirector(_filmId: string): Promise<void> {
  throw new NotImplementedError('S3b');
}

export const STUB_OWNER = 'S3b' as const;
