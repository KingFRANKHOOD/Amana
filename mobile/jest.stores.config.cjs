/**
 * Lightweight Jest config for pure store unit tests.
 *
 * These tests mock all native/expo dependencies and only exercise Zustand store logic.
 * Using the full jest-expo preset causes resolution failures due to a version mismatch
 * between jest-expo@52 and expo-modules-core@57 in this pnpm workspace (pre-existing
 * environment issue — confirmed broken on main before this branch).
 *
 * This config uses @babel/preset-typescript directly, avoiding the jest-expo preset
 * setup files that try to bootstrap native modules we don't need for store tests.
 */

const transformAllowList =
  '((jest-)?react-native' +
  '|@react-native(-community)?' +
  '|expo([-a-z]+)?' +
  '|@expo(nent)?/.*' +
  '|zustand)';

/** @type {import('jest').Config} */
module.exports = {
  displayName: 'stores',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/__tests__/stores/**/*.test.ts'],
  transform: {
    '\\.[jt]sx?$': [
      'babel-jest',
      {
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          '@babel/preset-typescript',
        ],
      },
    ],
  },
  transformIgnorePatterns: [
    `/node_modules/(?!${transformAllowList}/)(?!\\.pnpm/)`,
    `node_modules/\\.pnpm/[^/]+/node_modules/(?!${transformAllowList}/)`,
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
