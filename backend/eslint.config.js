import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'coverage/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // Código da aplicação: log só pelo pino; respostas por projeção explícita (pág. 06 §7).
    files: ['src/**/*.js'],
    rules: {
      'no-console': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TemplateElement[value.raw=/SELECT\\s+\\*/i]',
          message: 'Nunca SELECT *: use projeção explícita.',
        },
        {
          selector: 'Literal[value=/SELECT\\s+\\*/i]',
          message: 'Nunca SELECT *: use projeção explícita.',
        },
      ],
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.jest } },
  },
];
