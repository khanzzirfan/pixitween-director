// Owned by S12b. Short ids for inbox items.
import { randomBytes } from 'node:crypto';

export const createId = (prefix = 'i'): string => `${prefix}_${randomBytes(4).toString('hex')}`;
