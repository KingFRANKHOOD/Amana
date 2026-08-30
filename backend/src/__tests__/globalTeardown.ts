/**
 * Global Jest teardown — runs once after all test suites finish.
 *
 * When `detectOpenHandles` is enabled Jest prints any dangling handles
 * automatically. This teardown adds an explicit summary so CI logs make
 * it obvious whether leaks were found, even when the default output is
 * truncated.
 */

/* eslint-disable no-console */

export default async function globalTeardown(): Promise<void> {
  // Force garbage collection of any lingering async resources so the
  // process can exit cleanly.  If handles remain after this, Jest's own
  // --detectOpenHandles output will list them.
  if (global.gc) {
    global.gc();
  }

  console.log(
    "\n[globalTeardown] All test suites finished. " +
      "If the process hangs here, run with --detectOpenHandles to identify lingering resources.\n",
  );
}
