/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['./jest.setup.ts'],
  testMatch: [
    '**/__tests__/**/*.test.{ts,tsx}',
    '<rootDir>/src/**/*.test.{ts,tsx}',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/e2e/'],
  collectCoverage: true,
  coverageDirectory: './coverage',
  coverageReporters: ['text', 'lcov', 'clover'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
    '!src/**/*.test.{ts,tsx}',
  ],
  // Thresholds reflect current test coverage for the existing test suite.
  // Raise these as more tests are added (tracked in issue #1049).
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  // pnpm stores packages under node_modules/.pnpm/<name>@<ver>/node_modules/<name>/...
  // The leading slash + (?!\.pnpm) ensures we match the inner node_modules path (after .pnpm),
  // not the outer one, so packages like @react-native/js-polyfills and expo-modules-core
  // are correctly Babel-transformed even with pnpm's virtual store layout.
  transformIgnorePatterns: [
    '/node_modules/(?!\\.pnpm)(?!((jest-)?react-native|@react-native(-community)?|@react-native/.*|expo(nent)?|@expo(nent)?/.*|expo-modules-core|expo-[a-z-]+|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|zustand)/)',
  ],
};
