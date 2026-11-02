import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTheme, useWide } from './hooks';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
});

describe('useWide', () => {
  it('is true in jsdom where matchMedia is undefined', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useWide());
    expect(result.current).toBe(true);
  });

  it('follows a matchMedia change event', () => {
    let handler: (() => void) | null = null;
    const m = { matches: false, addEventListener: (_e: string, h: () => void) => void (handler = h), removeEventListener: () => void (handler = null) };
    vi.stubGlobal('matchMedia', () => m);
    const { result } = renderHook(() => useWide());
    expect(result.current).toBe(false);
    m.matches = true;
    act(() => handler?.());
    expect(result.current).toBe(true);
  });
});

describe('useTheme', () => {
  it('toggle sets data-theme=dark on <html> and remembers it', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
    expect(result.current.toggle()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('studio.theme')).toBe('dark');
  });

  it('toggling back to light sets data-theme=light, so a dark system setting cannot win', () => {
    localStorage.setItem('studio.theme', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    expect(result.current.toggle()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('still returns a value when localStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useTheme());
    expect(result.current.toggle()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
