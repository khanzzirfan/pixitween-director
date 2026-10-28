export const DENYLIST = [
  'nike',
  'adidas',
  'coca-cola',
  'coke',
  'pepsi',
  'starbucks',
  'iphone',
  'macbook',
  'samsung',
  'sony',
  'ikea',
  'lego',
  'disney',
  'marvel',
  'netflix',
  'tesla',
  'bmw',
  'mercedes',
  'ferrari',
  'toyota',
  'gucci',
  'prada',
  'chanel',
  'rolex',
  'red bull',
  'mcdonalds',
  "mcdonald's",
  'google',
  'amazon',
  'microsoft',
  'apple music',
  'puma',
  'reebok',
  'under armour',
  'louis vuitton',
  'cartier',
  'hermes',
  'tiffany',
  'porsche',
  'honda',
  'ford',
  'adobe',
];
export interface PromptViolation {
  rule: 'brand-name' | 'named-person';
  term: string;
}
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function lintPrompt(
  prompt: string,
  opts: { brandTerms?: string[]; subject?: boolean } = {},
): { ok: boolean; violations: PromptViolation[] } {
  const violations: PromptViolation[] = [];
  for (const term of [...DENYLIST, ...(opts.brandTerms ?? [])]) {
    if (
      term &&
      new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}($|[^\\p{L}\\p{N}])`, 'iu').test(prompt) &&
      !violations.some((v) => v.rule === 'brand-name' && v.term === term.toLowerCase())
    )
      violations.push({ rule: 'brand-name', term: term.toLowerCase() });
  }
  if (opts.subject) {
    const phrase = /\b(looks like|resembling|likeness of|celebrity|famous actor|in the style of)\b/i.exec(prompt);
    const pair = /\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/.exec(prompt);
    const candidate = phrase?.[0] ?? pair?.[0];
    if (candidate && !opts.brandTerms?.some((term) => candidate.toLowerCase().includes(term.toLowerCase())))
      violations.push({ rule: 'named-person', term: candidate });
  }
  return { ok: violations.length === 0, violations };
}
const STOP = new Set([
  'The',
  'This',
  'That',
  'It',
  'I',
  'We',
  'They',
  'A',
  'An',
  'Our',
  'No',
  'From',
  'For',
  'At',
  'In',
  'On',
  'And',
  'But',
  'Please',
  'Make',
  'Show',
  'Use',
  'Want',
  'Then',
]);
export function extractBrandTerms(text: string): string[] {
  const terms: string[] = [];
  const re = /\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?(?:\s+Co\.?)?/g;
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0;
    const before = text.slice(0, start);
    if (!before || /[.!?]\s*$/.test(before) || STOP.has(match[0].split(/\s/)[0]!)) continue;
    const value = match[0].replace(/\.$/, '');
    if (!terms.includes(value)) terms.push(value);
  }
  return terms;
}
