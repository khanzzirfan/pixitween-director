import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(cleanup);

// jsdom has no canvas 2D context; lottie-web touches one at import time.
vi.mock('lottie-web', () => ({ default: { loadAnimation: vi.fn(), setQuality: vi.fn() } }));
HTMLCanvasElement.prototype.getContext = (() => null) as never;
