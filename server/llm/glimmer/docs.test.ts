import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const doc = readFileSync('docs/local-mode.md', 'utf8');

it('has the required sections', () => {
  for (const h of ['What it is', 'Run it', 'What stays on your computer', 'What still uses the Meta API', 'Speed', 'Troubleshooting']) expect(doc).toContain(`## ${h}`);
});

it('is honest about what leaves the machine and about speed', () => {
  expect(doc).not.toMatch(/fully offline/i);
  expect(doc).toContain('OLLAMA_CONTEXT_LENGTH=32000');
  expect(doc).toContain('slower than Muse Spark');
  for (const api of ['Muse Image', 'SAM 3.1', 'Voice Transcribe', 'Clippy']) expect(doc).toContain(api);
});
