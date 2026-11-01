// Owned by S7a. The ONLY caller of ClippyClient.animateImage. A guard test fails if any other file calls it.
import type { ClippyClient } from '../clippy/mcp';
import { animateImageArgsSchema, type AnimateImageArgs, type SubmitResult } from '../clippy/types';
import type { ConsumedApproval } from './approval';

export function idempotencyKeyFor(filmId: string, sceneId: string, attempt: number): string {
  let key = [filmId, sceneId, String(attempt)].join(':').replace(/[^A-Za-z0-9._:-]/g, '_');
  if (key.length < 8) key += ':s7';
  return key.slice(0, 200);
}

export async function submitApproved(client: ClippyClient, approval: ConsumedApproval, args: AnimateImageArgs): Promise<SubmitResult> {
  const parsed = animateImageArgsSchema.parse(args);
  const expected = idempotencyKeyFor(approval.filmId, approval.sceneId, approval.attempt);
  if (parsed.idempotencyKey !== expected) throw new Error(`idempotencyKey '${String(parsed.idempotencyKey)}' does not match the approval's key '${expected}'`);
  return client.animateImage(parsed);
}
