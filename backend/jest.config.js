export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  globalSetup: '<rootDir>/tests/setup/global-setup.js',
  setupFiles: ['<rootDir>/tests/setup/env.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup/after-env.js'],
  testTimeout: 20_000,
};
