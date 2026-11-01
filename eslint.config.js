import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * The packages the app dropped. The app is Three.js only: the library, Pixi and the
 * React-Three wrappers are gone from package.json, so importing any of them is a bug.
 *
 * The list is the single source of truth for the fence, and every area that narrows the
 * rule starts from it. The nine dropped packages are
 * `reacthub-pixitweenjs`, `pixi.js`, `pixi-filters`, `gl-transitions`, `@pixi/react`,
 * `@pixi/sound`, `@react-three/fiber`, `@react-three/drei` and `@react-three/postprocessing`.
 *
 * The unscoped ones are named exactly; the two scoped families are fenced as a group, so
 * a new member of the family cannot sneak back in. A package is named exactly *or* matched
 * by a family, never both: `no-restricted-imports` reports one error per matching entry, so
 * naming `@pixi/react` and also matching `@pixi/*` would report the same import twice.
 */
const DROPPED_MESSAGE =
  'The app is Three.js only: the library and Pixi are gone. Use the engine in `engine/src` (`@engine/*`), which draws with Three.js and GSAP.';

const SCHEMA_MESSAGE =
  'The app owns its schema: import the types from `@shared/aep` and validate with `server/engine/light-validator.ts`.';

const DROPPED_PATHS = [
  { name: 'reacthub-pixitweenjs', message: SCHEMA_MESSAGE },
  { name: 'pixi.js', message: DROPPED_MESSAGE },
  { name: 'pixi-filters', message: DROPPED_MESSAGE },
  { name: 'gl-transitions', message: DROPPED_MESSAGE },
];

const DROPPED_PATTERNS = [
  {
    group: ['reacthub-pixitweenjs/*', 'pixi.js/*', 'pixi-filters/*', 'gl-transitions/*'],
    message: DROPPED_MESSAGE,
  },
  { group: ['@pixi/*'], message: DROPPED_MESSAGE },
  { group: ['@react-three/*'], message: DROPPED_MESSAGE },
];

/**
 * The repo-wide fence. A flat config replaces a rule wholesale when a later block
 * re-declares it, so an area that narrows the rule passes its extra entries here and
 * keeps the dropped packages.
 */
const fence = ({ paths = [], patterns = [] } = {}) => [
  'error',
  { paths: [...DROPPED_PATHS, ...paths], patterns: [...DROPPED_PATTERNS, ...patterns] },
];

export default tseslint.config(
  { ignores: ['node_modules', 'dist', 'web/dist', 'data', 'debug', '.ralph-tui', 'ralph', 'fixtures', 'docs', 'tmp'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
    },
  },
  {
    rules: {
      '@typescript-eslint/no-restricted-imports': fence(),
    },
  },
  {
    files: ['server/**', 'shared/**', 'scripts/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': fence({
        paths: [
          {
            name: '@shared/aep',
            allowTypeImports: true,
            message: 'The server validates with the light validator in `server/engine/light-validator.ts`; `@shared/aep` is a type-only contract here.',
          },
        ],
      }),
    },
  },
  { files: ['server/**', 'scripts/**', 'vitest.config.ts', 'eslint.config.js'], languageOptions: { globals: globals.node } },
  { files: ['web/**'], languageOptions: { globals: globals.browser } },
  {
    files: ['engine/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': fence({
        patterns: [
          {
            group: ['@shared', '@shared/*', '**/shared/**', '**/web/**', '**/server/**'],
            message: 'engine/ never imports from web/, server/ or shared/. See engine/docs/README.md (Folder layout).',
          },
        ],
      }),
    },
  },
);
