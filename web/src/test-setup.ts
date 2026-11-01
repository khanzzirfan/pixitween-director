import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(cleanup);

// jsdom has no canvas 2D context; lottie-web touches one at import time.
vi.mock('lottie-web', () => ({ default: { loadAnimation: vi.fn(), setQuality: vi.fn() } }));
// A test that runs in the node environment (the stored-film test reads data/films with node:fs)
// has no HTMLCanvasElement.
if (typeof HTMLCanvasElement !== 'undefined') HTMLCanvasElement.prototype.getContext = (() => null) as never;
