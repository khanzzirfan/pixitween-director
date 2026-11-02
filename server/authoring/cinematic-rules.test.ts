import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACTIONS, ANGLES, CUTS, MOVES, PHASES, PRODUCT_MOVES, SHEET_RULES, SHOT_SIZES, boardPrompt, checkBeatSheet, defaultBeatSheet } from './beatsheet';
import { CAMERA, MOTION_RULES, MOVE_RULES, SHEET, TEXT_RULES, VOCAB, ruleSentences, rulesMarkdown } from './cinematic-rules';
import { PUSH_FROM } from './cinematic-film';
import { floorElements } from './ingredients';
import { SET_AIR, SET_LOOKS } from './set-art';

const keys = (o: object) => Object.keys(o).sort();

describe('the vocabulary is one list', () => {
  it('the words the board schema accepts are exactly the rule book\'s', () => {
    expect([...SHOT_SIZES].sort()).toEqual(keys(VOCAB.sizes));
    expect([...MOVES].sort()).toEqual(keys(VOCAB.moves));
    expect([...ANGLES].sort()).toEqual(keys(VOCAB.angles));
    expect([...PHASES].sort()).toEqual(keys(VOCAB.phases));
    expect([...PRODUCT_MOVES].sort()).toEqual(keys(VOCAB.productMoves));
    expect([...CUTS].sort()).toEqual(keys(VOCAB.cuts));
    expect([...ACTIONS].sort()).toEqual(keys(VOCAB.actions));
    expect([...SET_LOOKS].sort()).toEqual(keys(VOCAB.looks));
    expect([...SET_AIR].sort()).toEqual(keys(VOCAB.air));
  });
});

describe('the numbers are used where they are written', () => {
  it('the checker reads the sheet rules from the book', () => {
    expect(SHEET_RULES).toBe(SHEET);
  });
  it('the camera reads its pushes from the book', () => {
    expect(PUSH_FROM.hook).toBe(CAMERA.pushFromHook);
    expect(PUSH_FROM.later).toBe(CAMERA.pushFromLater);
  });
  it('the checker\'s messages carry the book\'s numbers', () => {
    const els = floorElements('Stone Mug', 'home');
    const base = defaultBeatSheet(els);
    const many = { beats: base.beats.map((b, i) => (i < 4 ? { ...b, text: 'Hi there' } : b)) };
    expect(checkBeatSheet(many, els).join('|')).toContain(`at most ${TEXT_RULES.maxShots} shots carry text`);
    const longWhip = { beats: base.beats.map((b, i) => (i === 2 ? { ...b, move: 'whip' as const, seconds: MOVE_RULES.whipSeconds + 0.5 } : b)) };
    expect(checkBeatSheet(longWhip, els).join('|')).toContain(`at most ${MOVE_RULES.whipSeconds} s`);
  });
  it('the prompt teaches every move with its meaning, and the numbers of the shot list', () => {
    const p = boardPrompt({ title: 'Mug', seconds: 8 }).system;
    for (const [m, help] of Object.entries(VOCAB.moves)) {
      expect(p).toContain(m);
      expect(p).toContain(help);
    }
    for (const [l, help] of Object.entries(VOCAB.looks)) expect(p).toContain(`${l} (${help})`);
    expect(p).toContain(`${SHEET.minBeats}-${SHEET.maxBeats} shots`);
    expect(p).toContain(`at least ${MOVE_RULES.minKinds} different moves`);
  });
});

describe('the rules in words', () => {
  it('state every number the book holds', () => {
    const text = ruleSentences().join('\n');
    for (const n of [SHEET.minBeats, SHEET.maxBeats, SHEET.minTotal, SHEET.maxTotal, SHEET.firstMax, SHEET.minBeat, SHEET.maxBeat, CAMERA.pushFromHook, CAMERA.pushFromLater, MOVE_RULES.minKinds, MOVE_RULES.whipMax, TEXT_RULES.maxShots, TEXT_RULES.maxWords, TEXT_RULES.taglineWords, MOTION_RULES.stepSec]) {
      expect(text, String(n)).toContain(String(n));
    }
    expect(text).toContain(`${Math.round(SHEET.holdMin * 100)}% to ${Math.round(SHEET.holdMax * 100)}%`);
  });
  it('are in the docs file, which is written from the book (run npx tsx scripts/gen-cinematic-rules.ts when this fails)', () => {
    const file = readFileSync(new URL('../../docs/architecture/cinematic-rules.md', import.meta.url), 'utf8');
    expect(file).toBe(rulesMarkdown() + '\n');
  });
});
