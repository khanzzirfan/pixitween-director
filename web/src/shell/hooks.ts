// Owned by S14. Two small shell hooks: a width query that defaults to wide in jsdom, and a remembered theme.
import { useCallback, useEffect, useState } from 'react';

const WIDE_QUERY = '(min-width: 900px)';

/** True when the query matches; true when the browser has no matchMedia (so jsdom stays wide). */
export function useWide(query: string = WIDE_QUERY): boolean {
  const [wide, setWide] = useState<boolean>(() =>
    typeof window.matchMedia !== 'function' ? true : window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(query);
    const h = () => setWide(m.matches);
    m.addEventListener?.('change', h);
    return () => m.removeEventListener?.('change', h);
  }, [query]);
  return wide;
}

const THEME_KEY = 'studio.theme';
export type Theme = 'light' | 'dark';

function apply(theme: Theme): void {
  if (typeof document === 'undefined') return;
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
}

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'dark' || v === 'light') return v;
  } catch {
    /* storage may be unavailable */
  }
  // nothing remembered: follow the system setting, as the theme tokens do
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Remembers the theme in localStorage (guarded) and sets data-theme on <html>. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => apply(theme), [theme]);
  const toggle = useCallback((): Theme => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    apply(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage may be unavailable */
    }
    return next;
  }, [theme]);
  const set = useCallback((t: Theme) => {
    setTheme(t);
    apply(t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      /* storage may be unavailable */
    }
  }, []);
  return { theme, toggle, set };
}
