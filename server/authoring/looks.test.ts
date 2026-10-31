import { describe, expect, it } from 'vitest';
import { lintPrompt } from '../art/lint';
import { LOOKS, OCCASIONS, lookPlatePrompt, pickLook, productShape, type LookId, type OccasionId } from './looks';

describe('pickLook', () => {
  it('reads the pack shape', () => {
    expect(productShape(256, 752)).toBe('tall');
    expect(productShape(800, 800)).toBe('square');
    expect(productShape(3000, 400)).toBe('wide');
  });
  it.each([
    [{ title: 'Cold Brew 330ml', category: 'beverage', width: 256, height: 752 }, 'tabletop-hero'],
    [{ title: 'Stone Mug', category: 'homeware', width: 800, height: 800 }, 'lifestyle-room'],
    [{ title: 'Glow Serum', category: 'skincare', width: 300, height: 900 }, 'studio-pedestal'],
    [{ title: 'Party Cupcakes', category: 'cake', width: 900, height: 800 }, 'flat-lay'],
    [{ title: 'Citrus Soda', category: 'soda', width: 256, height: 752 }, 'ingredient-orbit'],
    [{ title: 'Snack Box', category: 'unknown', width: 3000, height: 1000 }, 'flat-lay'],
    [{ title: 'Anything', category: 'beverage', width: 256, height: 752, onSale: true }, 'price-promo'],
  ] as const)('%o → %s', (p, look) => {
    const pick = pickLook(p);
    expect(pick.look).toBe(look);
    expect(pick.why.length).toBeGreaterThan(5);
  });
  it('gives a tall round pack the 3D hero, but a sale still leads with the price and a short or flat pack stays 2D', () => {
    const can = { title: 'Cold Brew 330ml', category: 'beverage', width: 256, height: 752 };
    expect(pickLook({ ...can, round: true }).look).toBe('hero-3d');
    expect(pickLook({ ...can, round: true, onSale: true }).look).toBe('price-promo');
    expect(pickLook({ ...can, round: false }).look).toBe('tabletop-hero');
    expect(pickLook({ title: 'Stone Mug', category: 'homeware', width: 800, height: 800, round: true }).look).toBe('lifestyle-room');
  });
  it('finds the occasion in the words, everyday otherwise', () => {
    expect(pickLook({ title: 'Christmas Pudding', width: 800, height: 800 }).occasion).toBe('festive');
    expect(pickLook({ title: 'Iced Lemon Tea', width: 256, height: 752 }).occasion).toBe('summer');
    expect(pickLook({ title: 'Oat Milk', width: 256, height: 752 }).occasion).toBe('everyday');
  });
});

describe('lookPlatePrompt', () => {
  const looks = Object.keys(LOOKS) as LookId[];
  const occasions = Object.keys(OCCASIONS) as OccasionId[];
  it('fills every slot, keeps the type out and passes the prompt lint, for every look and occasion', () => {
    for (const look of looks) {
      for (const occasion of occasions) {
        const p = lookPlatePrompt(look, { occasion, productClass: 'cans', aspect: '9:16' });
        if (LOOKS[look].plate === null) {
          expect(p).toBeNull();
          continue;
        }
        expect(p).not.toMatch(/\{\w+\}/);
        expect(p).toMatch(/no text/);
        expect(p).toMatch(/no logos/);
        expect(p).toMatch(/^Vertical 9:16/);
        expect(lintPrompt(p!).ok).toBe(true);
      }
    }
  });
  it('never uses mood words the corpus bans', () => {
    for (const l of Object.values(LOOKS)) expect(l.plate ?? '').not.toMatch(/\b(cinematic|moody|stunning|gorgeous|beautiful|8k|masterpiece|epic)\b/i);
  });
});
