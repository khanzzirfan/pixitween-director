import type { MiddlewareHandler } from 'hono';
import { passcode } from './auth';

// Ordered. S8b appends its rate limits here (a named shared edit of this file).
export const middlewares: MiddlewareHandler[] = [passcode];
