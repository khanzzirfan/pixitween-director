import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync('web/src/styles/theme.css', 'utf8');
const block = (re: RegExp): string => re.exec(css)?.[1] ?? '';
const light = block(/^:root\s*\{([^}]*)\}/m);
const darkMedia = block(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/);
const darkAttr = block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);

const names = (b: string) => new Set([...b.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!).filter((n) => n !== '--text' && n !== '--surface'));
const value = (b: string, name: string) => new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(b)![1]!;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

it('defines the same tokens in the light block and both dark blocks', () => {
  expect(names(light).size).toBeGreaterThan(8);
  expect([...names(darkMedia)].sort()).toEqual([...names(light)].sort());
  expect([...names(darkAttr)].sort()).toEqual([...names(darkMedia)].sort());
  for (const n of ['--bg', '--fg', '--muted', '--card', '--border', '--accent', '--danger', '--radius', '--space-1', '--space-4']) {
    expect(names(light).has(n), n).toBe(true);
    expect(names(darkMedia).has(n), n).toBe(true);
  }
});

it('keeps text readable in both themes', () => {
  expect(contrast(value(light, '--fg'), value(light, '--bg'))).toBeGreaterThanOrEqual(4.5);
  expect(contrast(value(darkMedia, '--fg'), value(darkMedia, '--bg'))).toBeGreaterThanOrEqual(4.5);
  expect(contrast(value(darkAttr, '--fg'), value(darkAttr, '--bg'))).toBeGreaterThanOrEqual(4.5);
  // secondary text and the accent on the card surface too
  for (const [b, name] of [[light, 'light'], [darkMedia, 'dark']] as const) {
    expect(contrast(value(b, '--muted'), value(b, '--card')), `muted on card (${name})`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(value(b, '--accent'), value(b, '--card')), `accent on card (${name})`).toBeGreaterThanOrEqual(4.5);
  }
});

it('is imported by the app and never hides overflow on the page', () => {
  expect(readFileSync('web/src/main.tsx', 'utf8')).toContain("import './styles/theme.css'");
  expect(readFileSync('web/src/styles/responsive.css', 'utf8')).not.toMatch(/overflow-x:\s*hidden/);
});
