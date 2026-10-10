import js from '@eslint/js';
import globals from 'globals';

const NO_RAW_HTML = 'HTML só via html`` + setContent() (src/lib/html.js): escape automático contra XSS.';

export default [
  { ignores: ['node_modules/', 'public/assets/', 'public/vendor/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // innerHTML direto é proibido (pág. 06 §7 / 09); o único uso autorizado fica em lib/html.js.
      'no-restricted-syntax': [
        'error',
        { selector: 'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]', message: NO_RAW_HTML },
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: NO_RAW_HTML },
        { selector: "CallExpression[callee.property.name='createContextualFragment']", message: NO_RAW_HTML },
        { selector: "CallExpression[callee.object.name='document'][callee.property.name=/^write(ln)?$/]", message: NO_RAW_HTML },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  {
    files: ['scripts/**/*.js', 'tests/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
];
