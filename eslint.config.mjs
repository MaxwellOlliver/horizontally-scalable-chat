import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.turbo/**',
      '**/node_modules/**',
      '**/*.gen.ts',
      '**/migrations/**',
      'apps/ws-gateway-go/**', // Go — linted by golangci-lint
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // Allow intentionally-unused args/vars prefixed with `_`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Web client (browser + React hooks rules)
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      ...reactRefresh.configs.vite.rules,
      // Reset-on-key and ref-sync are deliberate here — advise, don't block.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      // HMR-only hint; our context files co-locate a provider with its hook,
      // and that's an intentional, correct pattern. Advise, don't block.
      'react-refresh/only-export-components': 'warn',
    },
  },

  // Route + entry files: file-based routing mandates exporting `Route`/loaders
  // alongside the component, which this HMR-only rule can't accommodate.
  {
    files: ['apps/web/src/routes/**/*.tsx', 'apps/web/src/main.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },

  // Node services + shared platform package
  {
    files: ['services/**/*.ts', 'packages/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // Tooling/config files run in Node
  {
    files: ['**/*.config.{ts,mts,js,mjs}'],
    languageOptions: { globals: globals.node },
  },

  // Tests: pragmatic casts are fine
  {
    files: ['**/__tests__/**', '**/*.test.{ts,tsx}'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },

  // Keep ESLint out of formatting's lane (Prettier owns style)
  prettier,
)
