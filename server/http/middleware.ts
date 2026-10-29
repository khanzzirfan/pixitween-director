import type { MiddlewareHandler } from 'hono';
import { passcode } from './auth';
import { createFilmLimit } from './film-limit';
import { createGenerateCap } from './generate-cap';
import { createUploadLimit } from './upload-limit';

// Ordered. S8b appends its rate limits here (a named shared edit of this file).
// The passcode runs first, so a rejected request never uses up a visitor's quota.
export const middlewares: MiddlewareHandler[] = [passcode, createUploadLimit(), createFilmLimit(), createGenerateCap()];
