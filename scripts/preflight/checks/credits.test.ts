import { expect, it } from 'vitest';
import { makeCtx } from '../testing';
import { checkAssetCredits } from './credits';

const ctx = (credits: string | undefined, tracked: string[]) => makeCtx(credits === undefined ? {} : { 'ASSET-CREDITS.md': credits }, { tracked });

it('credits fixtures/seed/mug-product.png through a folder row, and not without one', () => {
  expect(checkAssetCredits(ctx('| `fixtures/seed/*` | our own photos |', ['fixtures/seed/mug-product.png']))[0]!.status).toBe('pass');
  expect(checkAssetCredits(ctx('| nothing |', ['fixtures/seed/mug-product.png']))[0]!.status).toBe('fail');
  expect(checkAssetCredits(ctx('fixtures/seed/mug-product.png: ours', ['fixtures/seed/mug-product.png']))[0]!.status).toBe('pass');
});

it('lists a tracked gif that is not mentioned', () => {
  const r = checkAssetCredits(ctx('| `fixtures/seed/*` |', ['docs/media/demo.gif', 'fixtures/seed/a.png']))[0]!;
  expect(r.status).toBe('fail');
  expect(r.detail).toContain('docs/media/demo.gif');
  expect(r.detail).not.toContain('fixtures/seed/a.png');
});

it('never reports node_modules or web/dist', () => {
  expect(checkAssetCredits(ctx('x', ['node_modules/x/a.png', 'web/dist/assets/b.png', 'README.md']))[0]!.status).toBe('pass');
});

it('does not treat a folder row as crediting a folder with a similar name', () => {
  expect(checkAssetCredits(ctx('`fixtures/seed/*`', ['fixtures/seed2/a.png']))[0]!.status).toBe('fail');
});

it('fails when ASSET-CREDITS.md is missing', () => {
  expect(checkAssetCredits(ctx(undefined, ['a.png']))[0]!.status).toBe('fail');
});
