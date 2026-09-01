/**
 * Structured logger (Pino-based in production).
 *
 * Exports a minimal interface so services can import `logger` directly
 * without pulling in the full Pino stack during tests.
 */

type LogFn = (data: Record<string, unknown>, msg?: string) => void;

function noop() {}

export const logger: {
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  debug: LogFn;
} = {
  info: noop,
  warn: noop,
  error: noop,
  debug: noop,
};
