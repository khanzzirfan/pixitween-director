// Owned by S10. A secret-scan hit that is known to be harmless, with the reason.
export interface Allow {
  path: string;
  pattern: string;
  why: string;
}

const TEST_INPUT = 'a test that feeds the scanner a made-up secret on purpose';
const PRD_TEXT = 'acceptance-criteria text of a PRD that quotes a made-up secret';
const MUG = 'our own mug photo (a 192 px JPEG) embedded in a hand-made fixture composition';

export const ALLOWLIST: Allow[] = [
  ...['key-assignment', 'openai-style-key', 'aws-access-key-id', 'github-token', 'private-key-block', 'signed-url', 'bearer-token', 'base64-data-url'].map((pattern) => ({ path: 'scripts/preflight/checks/secrets.test.ts', pattern, why: TEST_INPUT })),
  { path: 'scripts/preflight/checks/env.test.ts', pattern: 'key-assignment', why: TEST_INPUT },
  { path: 'deploy/predeploy-check.test.ts', pattern: 'bearer-token', why: TEST_INPUT },
  ...['ralph/prd-s08b-deploy.json', 'ralph/src/prd-s08b-deploy.json', 'ralph/views/prd-s08b-deploy.md'].map((path) => ({ path, pattern: 'bearer-token', why: PRD_TEXT })),
  ...['ralph/prd-s10-docs-submission.json', 'ralph/src/prd-s10-docs-submission.json', 'ralph/views/prd-s10-docs-submission.md'].map((path) => ({ path, pattern: 'key-assignment', why: PRD_TEXT })),
  ...['three-scene-pan', 'two-scene-dolly', 'vertical-parallax'].map((name) => ({ path: `fixtures/s03a/valid/${name}.json`, pattern: 'base64-data-url', why: MUG })),
];
