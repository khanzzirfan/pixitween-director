import type { LlmBackend } from '@shared/ports';
import { NotImplementedError } from '../errors';

// Stub: S9 replaces this whole file.
export const STUB_OWNER = 'S9';

export function createGlimmerBackend(): LlmBackend {
  return {
    id: 'glimmer',
    async chatWithTools() {
      throw new NotImplementedError(STUB_OWNER);
    },
  };
}
