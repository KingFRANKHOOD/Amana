/**
 * Custom Jest resolver to fix pnpm's nested node_modules layout with expo packages.
 *
 * jest-expo's setup.js runs from deep inside node_modules/.pnpm/jest-expo.../node_modules/
 * and tries to require 'expo-modules-core/src/Refs'. Node's resolver walks up looking for
 * a node_modules/expo-modules-core that contains src/Refs, but pnpm's virtual store keeps
 * expo-modules-core in a separate entry that isn't on that ancestor path.
 *
 * This resolver intercepts expo-modules-core sub-path imports and resolves them from
 * the project root's node_modules symlink, which points to the real pnpm package location.
 * Bare 'expo-modules-core' imports are left to the default resolver so package.json#main
 * is respected properly.
 */

const path = require('path');
const fs = require('fs');

// The actual expo-modules-core location (resolved via the top-level symlink we created)
const EXPO_MODULES_CORE_ROOT = path.resolve(
  __dirname,
  'node_modules/expo-modules-core'
);

// Sub-path stubs for entries that jest-expo setup.js references but don't exist in
// expo-modules-core@57 (they were removed or relocated between versions).
const SUBPATH_STUBS = new Set([
  'expo-modules-core/src/web/index.web',   // doesn't exist in v57
  'expo-modules-core/src/uuid/uuid.web',    // doesn't exist in v57
]);

module.exports = (request, options) => {
  // Only intercept sub-path imports, not bare 'expo-modules-core'
  if (request.startsWith('expo-modules-core/')) {
    // Return empty stub for known missing paths
    if (SUBPATH_STUBS.has(request)) {
      return require.resolve('./jest.stub-empty.cjs');
    }

    const subPath = request.slice('expo-modules-core/'.length);
    const resolved = path.join(EXPO_MODULES_CORE_ROOT, subPath);

    // Try the path directly, then with common extensions
    const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.native.ts', '.native.js'];
    for (const ext of extensions) {
      const candidate = resolved + ext;
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) {
          return candidate;
        }
      } catch (_) {
        // not found with this extension, try next
      }
    }

    // Fall through to default resolver if we couldn't find it
  }

  return options.defaultResolver(request, options);
};
