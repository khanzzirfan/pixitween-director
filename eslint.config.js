import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

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
    files: ['server/**', 'shared/**', 'scripts/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'reacthub-pixitweenjs',
              allowTypeImports: true,
              message: 'The engine is browser-only. Use `import type`, or the validator in server/engine/validate.ts.',
            },
          ],
          patterns: [
            {
              group: ['reacthub-pixitweenjs/*'],
              allowTypeImports: true,
              message: 'The engine is browser-only. Use `import type`, or the validator in server/engine/validate.ts.',
            },
          ],
        },
      ],
    },
  },
  { files: ['server/**', 'scripts/**', 'vitest.config.ts', 'eslint.config.js'], languageOptions: { globals: globals.node } },
  { files: ['web/**'], languageOptions: { globals: globals.browser } },
  {
    files: ['engine/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'reacthub-pixitweenjs',
              message: 'The engine is our own port and never imports the library. See engine/docs/README.md (Quality bar).',
            },
            {
              name: '@pixi/react',
              message: 'The engine uses Pixi directly, not @pixi/react. See engine/docs/README.md (Decisions).',
            },
          ],
          patterns: [
            {
              group: ['reacthub-pixitweenjs/*', '@react-three/*'],
              message: 'Not allowed in engine/. See engine/docs/README.md (Quality bar).',
            },
            {
              group: ['@shared', '@shared/*', '**/shared/**', '**/web/**', '**/server/**'],
              message: 'engine/ never imports from web/, server/ or shared/. See engine/docs/README.md (Folder layout).',
            },
          ],
        },
      ],
    },
  },
);
