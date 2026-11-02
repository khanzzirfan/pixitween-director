// How wide a word is, in em (1 em = the font size), so a line of words can be laid out without a browser. The text is drawn in the browser
// with 'Inter, Helvetica, Arial, sans-serif'; Inter is about 3 % wider than Helvetica, so the widths below (the standard Helvetica advance
// widths, in 1/1000 em, for printable ASCII) are scaled up by that much and every line gets a little room rather than too little.

const REGULAR =
  '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 ' +
  '667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 ' +
  '556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584';
const BOLD =
  '278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 ' +
  '722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 ' +
  '556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584';

const table = (s: string): number[] => s.split(' ').map((n) => Number(n) / 1000);
const REG = table(REGULAR);
const BLD = table(BOLD);
/** The widest a printable character that is not in the tables is taken to be. */
const OTHER = 0.6;
/** Inter is a little wider than Helvetica. */
const INTER = 1.03;
/** Accented Latin letters (Latin-1 and Latin Extended-A/B) are about as wide as a plain letter. */
const ACCENTED = 0.56;
/** Full-width scripts (CJK, Hangul, kana, full-width forms) and emoji are one em wide. */
const WIDE: Array<[number, number]> = [[0x1100, 0x115f], [0x2e80, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1faff], [0x20000, 0x3fffd]];
const isWide = (code: number): boolean => WIDE.some(([a, b]) => code >= a && code <= b);

/** The advance width of one space, em. */
export const SPACE_EM = REG[0]! * INTER;

/** The width of `text` (no line breaks) in em. */
export function textEm(text: string, bold = false): number {
  const t = bold ? BLD : REG;
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    w += code >= 32 && code <= 126 ? t[code - 32]! : isWide(code) ? 1 / INTER : code >= 0xc0 && code <= 0x24f ? ACCENTED : OTHER;
  }
  return w * INTER;
}
