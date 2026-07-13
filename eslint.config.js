// -------------------------------------------------------------------------
// eslint.config.js
// ESLint is a tool that analyzes our code to quickly find problems and enforce
// coding standards. This file uses the new "Flat Config" format.
// -------------------------------------------------------------------------

import globals from 'globals';
import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['**/.next/**', '**/dist/**', '**/node_modules/**', 'apps/web/**'],
  },
  // 1. Base Recommended Rules
  // We start by extending ESLint's default recommended rules which catch common bugs.
  js.configs.recommended,

  // 2. Environment Globals
  {
    languageOptions: {
      // This tells ESLint what global variables exist in our environment.
      // We include both Node.js globals (like `process`) and Browser globals (like `window`).
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    // 3. Strict Rules for a JS-only stack
    // Since we are not using TypeScript, we make ESLint extra strict to catch errors.
    rules: {
      // "no-undef": Throws an error if you use a variable that hasn't been defined.
      'no-undef': 'error',
      // "no-unused-vars": Throws an error if you define a variable but never use it.
      'no-unused-vars': 'error',
      // "eqeqeq": Forces the use of `===` and `!==` instead of `==` and `!=` to avoid type coercion bugs.
      eqeqeq: ['error', 'always'],
    },
  },

  // 4. Monorepo Import Boundary Rule
  {
    // This specific rule block only applies to files inside the `packages/` folder.
    files: ['packages/**/*.js', 'packages/**/*.jsx'],
    rules: {
      // We strictly forbid shared "packages" from importing code out of "apps".
      // Apps can import packages, but packages cannot import apps. This keeps our architecture clean.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // We block any import path that tries to reach into an apps/ directory.
              group: [
                'apps/*',
                '*/apps/*',
                '../../apps/*',
                '../../../apps/*',
                '../../../../apps/*',
              ],
              message: 'Packages must not import from apps. This violates the monorepo boundary.',
            },
          ],
        },
      ],
    },
  },

  // 5. Prettier Integration
  // This must be the LAST item in the array. It automatically disables any
  // ESLint rules that would conflict with Prettier's automatic formatting.
  eslintConfigPrettier,
];
