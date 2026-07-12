import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'node_modules/', 'data/', 'design_handoff_brieftrack_redesign/'] },

  js.configs.recommended,

  // Frontend (browser)
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: globals.browser,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // JSX runtime (Vite) — no React import needed for JSX.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // Refs-in-render is this codebase's documented animation architecture
      // (ARCHITECTURE.md §7): the RAF sim mutates nodesRef and renders read it.
      'react-hooks/refs': 'off',
      // Compiler-era strictness — worth revisiting, but not errors today.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // react-three-fiber renders three.js props (args, position, intensity, …)
  // that the react plugin doesn't recognise as DOM attributes.
  {
    files: ['src/components/diagram/Stacked3D.jsx'],
    rules: { 'react/no-unknown-property': 'off' },
  },

  // Server + tests + config (Node)
  {
    files: ['server/**/*.js', 'test/**/*.{js,jsx}', 'vite.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // Component tests render JSX and set globalThis.React (classic runtime under tsx).
  {
    files: ['test/**/*.{js,jsx}'],
    plugins: { react },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.node, ...globals.browser, React: 'readonly' },
    },
    settings: { react: { version: 'detect' } },
  },
];
