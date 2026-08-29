/** @type {import('jest').Config} */

// Packages that contain JSX/TypeScript/Flow and must be transformed by Babel.
// Using a shared list to keep both patterns in sync.
const transformAllowList =
  '((jest-)?react-native' +
  '|@react-native(-community)?' +
  '|@react-native/js-polyfills' +
  '|expo([-a-z]+)?' +        // expo, expo-modules-core, expo-secure-store, etc.
  '|@expo(nent)?/.*' +
  '|@expo-google-fonts/.*' +
  '|react-navigation' +
  '|@react-navigation/.*' +
  '|@unimodules/.*' +
  '|unimodules' +
  '|sentry-expo' +
  '|native-base' +
  '|react-native-svg' +
  '|zustand)';

module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['./jest.setup.ts'],
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  // Two-pattern approach to support pnpm's nested node_modules layout.
  // transformIgnorePatterns: if a path matches ANY pattern it will NOT be transformed.
  //   Pattern A: blocks non-allowed packages in the top-level node_modules (skips .pnpm/)
  //   Pattern B: blocks non-allowed packages inside pnpm's .pnpm/<name>/node_modules/<dep>
  transformIgnorePatterns: [
    // Pattern A: regular top-level packages — skip .pnpm itself, block everything else not allowed
    `/node_modules/(?!${transformAllowList}/)(?!\\.pnpm/)`,
    // Pattern B: pnpm inner packages (node_modules/.pnpm/<name>/node_modules/<dep>)
    `node_modules/\\.pnpm/[^/]+/node_modules/(?!${transformAllowList}/)`,
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/__tests__/**',
    '!src/**/index.{ts,tsx}',
    '!src/**/*.d.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },
  coverageReporters: ['text', 'lcov', 'html'],
};
