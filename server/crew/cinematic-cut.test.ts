import { describe, expect, it } from 'vitest';
import { boardPrompt } from '../authoring/beatsheet';
import { pricesIn } from './cinematic-cut';

describe('pricesIn', () => {
  it('shows the lowest price and keeps the highest as the one it was', () => {
    expect(pricesIn('COLD BREW NOW $3.50 IN STORE — WAS $5.00 $5.00 → $3.50')).toEqual({ price: 3.5, was: 5 });
  });
  it('has no was-price when only one price is named', () => {
    expect(pricesIn('Grab yours for $4')).toEqual({ price: 4 });
  });
  it('is undefined when no price is named', () => {
    expect(pricesIn('a calm morning can')).toBeUndefined();
  });
});

describe('boardPrompt', () => {
  it('hands the director the client brief and the craft rules, so a cold brief is enriched, not copied', () => {
    const p = boardPrompt({ title: 'Cold Brew', brief: 'cold brew can now $3.50', seconds: 8 });
    expect(p.user).toContain('cold brew can now $3.50');
    expect(p.system).toContain("DIRECTOR'S CRAFT");
  });
  it('asks without a brief line when there is none', () => {
    expect(boardPrompt({ title: 'Cold Brew', seconds: 8 }).user).not.toContain("client's brief");
  });
});
