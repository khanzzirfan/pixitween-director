// Owned by S10. The submission documents say what is true: structure, counts and every claim that can be checked from the repository.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { posix } from 'node:path';
import { expect, it } from 'vitest';
import { EXPECTED_PRDS } from './checks/prd';

const root = new URL('../../', import.meta.url).pathname;
const read = (p: string) => readFileSync(root + p, 'utf8');
const section = (text: string, heading: string): string => {
  const m = new RegExp(`^## ${heading}\\s*$`, 'm').exec(text);
  if (!m) return '';
  const rest = text.slice(m.index + m[0].length);
  const next = /^## /m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
};
/** Files git knows about, plus new ones it does not ignore: the pack can be checked before it is committed. */
const tracked = (): string[] => execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

const LIVE_GATES = ['s02-smoke', 's03-director', 's04-art', 's05-review', 's06-chat', 's07-generate', 's09-local', 's11-mcp'];

// ---- new-vs-existing ----
it('new-vs-existing has its five headings, says when the history starts and names the engine version from the lockfile', () => {
  const t = read('docs/new-vs-existing.md');
  for (const h of ['# New vs existing', '## Built during the hackathon', '## Pre-existing', '## Build process', '## How to verify']) expect(t).toContain(h);
  expect(t).toContain('The repository history starts on 28 Oct 2026');
  const first = execFileSync('git', ['log', '--reverse', '--format=%aI'], { cwd: root, encoding: 'utf8' }).split('\n')[0]!.slice(0, 10);
  expect(first).toBe('2026-10-28'); // the sentence above is the date git shows
  const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { version: string }> };
  expect(section(t, 'Pre-existing')).toContain(lock.packages['node_modules/reacthub-pixitweenjs']!.version);
});

it('new-vs-existing names every PRD of the first wave and every planned live gate in the build process', () => {
  const build = section(read('docs/new-vs-existing.md'), 'Build process');
  for (const stem of EXPECTED_PRDS) expect(build, stem).toContain(stem);
  for (const gate of LIVE_GATES) expect(build, gate).toContain(gate);
  expect(build).toContain('14 PRDs');
});

it('new-vs-existing names every top-level folder of the repository', () => {
  const dirs = [...new Set(tracked().filter((p) => p.includes('/')).map((p) => p.split('/')[0]!))];
  const t = read('docs/new-vs-existing.md');
  for (const d of dirs) expect(t, d).toContain(`\`${d}/\``);
});

// ---- architecture ----
it('architecture has its five headings and at least two mermaid diagrams', () => {
  const t = read('docs/architecture.md');
  for (const h of ['# Architecture', '## System overview', '## Film lifecycle', '## Tools and the composition', '## Where Meta models are used']) expect(t).toContain(h);
  expect(t.match(/```mermaid/g)?.length).toBeGreaterThanOrEqual(2);
});

it('architecture names only events that exist, and every Meta model row of the table', () => {
  const t = read('docs/architecture.md');
  const events = read('shared/events.ts');
  const dotted = [...t.matchAll(/`([a-z]+(?:\.[a-z]+)+)`/g)].map((m) => m[1]!).filter((n) => !/\.(ts|tsx|json|jsonl|md|js|png|css|html|yml|yaml)$/.test(n));
  expect(dotted.length).toBeGreaterThan(0);
  for (const n of dotted) expect(events, n).toContain(`'${n}'`);
  const table = section(t, 'Where Meta models are used');
  for (const id of ['muse-spark-1.3-contributor', 'muse-image-1.0', 'sam-3.1', 'muse-voice-transcribe-1.0', 'muse-wonder-1.0', 'muse-glimmer:30b-mlx']) expect(table, id).toContain(id);
});

it('architecture names the real folders it points at', () => {
  const t = read('docs/architecture.md');
  const folders = [...t.matchAll(/`((?:server|web|shared)\/[\w/.-]+\/)`/g)].map((m) => m[1]!);
  expect(folders.length).toBeGreaterThan(5);
  for (const f of folders) expect(existsSync(root + f), f).toBe(true);
});

// ---- README ----
it('README links every call site of the Meta models table to a file that exists', () => {
  const t = section(read('README.md'), 'Meta models used');
  const targets = [...t.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]!);
  expect(targets.length).toBeGreaterThanOrEqual(6);
  const all = new Set(tracked());
  for (const target of targets) expect(all.has(target), target).toBe(true);
});

it('README has the pitch, the owner markers and no draft text', () => {
  const t = read('README.md');
  expect(t.startsWith('# PixiTween Director')).toBe(true);
  for (const m of ['gif', 'live-url', 'video-url', 'cost-table', 'team']) expect(t, m).toContain(`<!-- OWNER:${m} -->`);
  expect(t).not.toContain('<fill:');
  const order = ['## What it does', '## Demo', '## Meta models used', '## Architecture'].map((h) => t.indexOf(h));
  expect(order.every((n) => n > 0) && [...order].sort((a, b) => a - b).join() === order.join()).toBe(true);
});

it('README runs only npm scripts that exist, and its limitations carry the verified findings', () => {
  const t = read('README.md');
  const scripts = Object.keys((JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts);
  for (const m of t.matchAll(/npm run ([\w:-]+)/g)) expect(scripts, m[1]).toContain(m[1]);
  const lim = section(t, 'Limitations');
  for (const s of ['coarse', 'no video- or speech-generation model', 'repeats some words', 'not the fast one', '1920x1280']) expect(lim, s).toContain(s);
  expect(section(t, 'Built during the hackathon')).toContain('14 PRDs');
  expect(section(t, 'Cost per film')).toContain('`cost` event');
});

it('README never calls the engine open source or Apache-2.0', () => {
  const t = read('README.md');
  expect(t).not.toMatch(/open[- ]source[^.\n]*(engine|reacthub)|(engine|reacthub)[^.\n]*open[- ]source/i);
  expect(t).toContain('source-available');
});

it('the public documents never link into a folder that is not committed', () => {
  for (const f of ['README.md', ...readdirSync(root + 'docs').filter((n) => n.endsWith('.md')).map((n) => `docs/${n}`)]) {
    const t = read(f);
    expect(t, f).not.toMatch(/\]\((\.\.\/)*docs\/hackathon|\]\((\.\.\/)*docs\/learn-improve|\(\.\.\/\.\.\//);
  }
});

// ---- demo script ----
const narration = (): string => section(read('docs/demo-script.md'), 'Narration').replace(/\*\*\d+:\d{2}\*\*/g, '');

it('demo narration is between 250 and 380 words', () => {
  const n = words(narration());
  expect(n).toBeGreaterThanOrEqual(250);
  expect(n).toBeLessThanOrEqual(380);
});

it('demo shot list has at least 12 rows, each with a valid time', () => {
  const rows = section(read('docs/demo-script.md'), 'Shot list').split('\n').filter((l) => /^\|/.test(l)).slice(2);
  expect(rows.length).toBeGreaterThanOrEqual(12);
  for (const row of rows) {
    const time = row.split('|')[1]!.trim();
    expect(time, row).toMatch(/^\d:\d{2}(–\d:\d{2})?$/);
  }
});

it('demo script has its labels and its headings', () => {
  const t = read('docs/demo-script.md');
  for (const h of ['# Demo script (3:00)', '## Beats and timing', '## Narration', '## Shot list', '## On-screen labels', '## Recording checklist']) expect(t).toContain(h);
  const labels = section(t, 'On-screen labels');
  for (const s of [
    'Built during the Meta Global AI Developer Hackathon, 27 Oct – 4 Nov 2026',
    'Engine: reacthub-pixitweenjs (source-available, pre-existing)',
    'Video model: Clippy (pre-existing service), approved by the user',
    'Muse Glimmer 30B, local, open weights',
  ])
    expect(labels, s).toContain(s);
});

// ---- submission answers ----
it('the project description is 180 to 230 words and the bonus claims are short and path-free', () => {
  const t = read('docs/submission-answers.md');
  for (const h of ['# Submission answers', '## Project description', '## Track and theme', '## Bonus prizes', '## Claim evidence', '## Links']) expect(t).toContain(h);
  const n = words(section(t, 'Project description'));
  expect(n).toBeGreaterThanOrEqual(180);
  expect(n).toBeLessThanOrEqual(230);
  const rows = section(t, 'Bonus prizes').split('\n').filter((l) => /^\|/.test(l)).slice(2);
  expect(rows).toHaveLength(5);
  for (const row of rows) {
    const claim = row.split('|')[2]!.trim();
    expect(words(claim), claim).toBeLessThanOrEqual(60);
    expect(claim).not.toContain('`');
  }
});

it('every evidence path of a claimed row is a file in the repository', () => {
  const rows = section(read('docs/submission-answers.md'), 'Claim evidence').split('\n').filter((l) => /^\|/.test(l)).slice(2);
  const all = new Set(tracked());
  let checked = 0;
  for (const row of rows) {
    const [, , evidence = '', claimed = ''] = row.split('|').map((c) => c.trim());
    if (!claimed.startsWith('yes')) continue;
    for (const m of evidence.matchAll(/`([^`]+)`/g)) {
      checked++;
      expect(all.has(m[1]!), m[1]).toBe(true);
    }
  }
  expect(checked).toBeGreaterThan(10);
});

// ---- x post ----
it('the X post is at most 280 characters with each owner marker counted as 23, and has no @', () => {
  const t = read('docs/x-post.md');
  for (const h of ['# X post and Discord post', '## X post', '## Discord post', '## Posting checklist']) expect(t).toContain(h);
  const post = section(t, 'X post').split('\n').find((l) => l.startsWith('> '))!.slice(2);
  const length = post.replace(/<!-- OWNER:[\w-]+ -->/g, 'x'.repeat(23)).length;
  expect(length).toBeLessThanOrEqual(280);
  expect(post).not.toContain('@');
  const discord = section(t, 'Discord post');
  for (const m of ['live-url', 'repo-url', 'video-url']) expect(discord).toContain(`OWNER:${m}`);
});

// ---- s1 evidence ----
it('s1-evidence names every seed fixture and all eight live gates, and says the probe scripts are not copied', () => {
  const t = read('docs/s1-evidence.md');
  for (const h of ['# S1 evidence: what we measured on day 1', '## What was probed', '## Results', '## How to reproduce']) expect(t).toContain(h);
  for (const f of tracked().filter((p) => p.startsWith('fixtures/seed/') && !p.endsWith('README.md'))) expect(t, f).toContain(posix.basename(f));
  expect(t).toContain('not copied into this repository');
  for (const gate of LIVE_GATES) expect(section(t, 'How to reproduce'), gate).toContain(`\`${gate}\``);
});

it('every latency in the s1-evidence results is one the day-one findings record', () => {
  const findings = 'docs/hackathon/steps/step-01-meta-api-probes/findings.md';
  if (!existsSync(root + findings)) return; // the findings are the author's private notes; the check runs where they are
  const f = read(findings).replace(/\u2013|–/g, '-');
  const table = section(read('docs/s1-evidence.md'), 'Results').replace(/\u2013|–/g, '-');
  const stated = [...table.matchAll(/(\d+(?:\.\d+)?)(?: to (\d+(?:\.\d+)?))? s\b/g)];
  expect(stated.length).toBeGreaterThan(5);
  for (const m of stated) {
    const ok = m[2] ? new RegExp(`${m[1]}\\s*(?:-|to)\\s*${m[2]}\\s*s`).test(f) : new RegExp(`(?<![\\d.])${m[1].replace('.', '\\.')}\\s*s\\b`).test(f);
    expect(ok, m[0]).toBe(true);
  }
});
