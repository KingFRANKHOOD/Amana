/**
 * Jest setupFilesAfterFramework — runs after the test framework is installed.
 *
 * Provides global cleanup hooks that help prevent open-handle leaks when
 * forceExit is removed from the Jest config (issue #1080).
 */

import { prisma } from "../lib/db";

/**
 * After each test suite, attempt to disconnect any lingering Prisma
 * connections that individual test files may have opened without
 * cleaning up.
 */
afterAll(async () => {
  try {
    await prisma.$disconnect();
  } catch {
    // Prisma client may already be disconnected — ignore.
  }
});
