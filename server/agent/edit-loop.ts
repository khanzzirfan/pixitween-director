// Owned by S6 (PRD prd-s06-chat-edit). S2 stub: replace the body, keep the export names.
import { NotImplementedError } from '../errors';

export async function runEdit(
  _filmId: string,
  _message: string,
  _selection?: { sceneId?: string; layerId?: string },
  _opts?: { local?: boolean },
): Promise<unknown> {
  throw new NotImplementedError('S6');
}

export const STUB_OWNER = 'S6' as const;
