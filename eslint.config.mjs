import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// CLAUDE.md: business logic must read time from @rocan/clock.
const noWallClock = [
  'error',
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: 'Use Clock.now() from @rocan/clock instead of new Date() (MOCK_TESTING §4).',
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: 'Use Clock.now() from @rocan/clock instead of Date.now() (MOCK_TESTING §4).',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/next-env.d.ts',
      'packages/db/migrations/**',
      'playwright-report/**',
      'apps/web/public/vendor/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
    rules: {
      'no-restricted-syntax': noWallClock,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Service worker globals.
    files: ['apps/web/public/sw.js'],
    languageOptions: {
      globals: { self: 'readonly', caches: 'readonly', fetch: 'readonly', URL: 'readonly' },
    },
  },
  {
    files: ['scripts/**/*.mjs', 'apps/*/scripts/**/*.mjs'],
    languageOptions: { globals: { setTimeout: 'readonly', fetch: 'readonly' } },
  },
  {
    // The clock itself, and tests that measure real elapsed time.
    files: ['packages/clock/src/**', '**/test/**', 'e2e/**', 'scripts/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
