/**
 * Centralized backend API origin for Playwright network mocks.
 *
 * Playwright's `page.route(...)` needs an absolute URL (or glob) to intercept a
 * request, so specs cannot rely on the relative `baseURL` from
 * `playwright.config.ts`. Keeping the backend origin in one place means a port
 * or host change is a single edit (or an env var) instead of a sweep across
 * every spec.
 *
 * Resolution order:
 *   1. `PLAYWRIGHT_API_URL`  – explicit override for E2E / CI runs
 *   2. `NEXT_PUBLIC_API_URL` – the same var the app itself reads
 *                              (see `src/lib/api/env.ts`), so mocks stay aligned
 *                              with the real client when only that is set
 *   3. `http://localhost:4000` – local dev default (backend `PORT` default)
 */
export const API_BASE_URL: string = (
  process.env.PLAYWRIGHT_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:4000"
).replace(/\/+$/, "");

/**
 * Build an absolute API URL / route pattern for a given path.
 *
 * Accepts plain paths (`/trades`), templated paths (`/trades/${id}`) and
 * Playwright glob patterns (`/trades?**`, `/disputes?**`).
 *
 * @example
 *   await page.route(apiUrl("/trades?**"), handler);
 *   await page.route(apiUrl(`/trades/${tradeId}/evidence`), handler);
 */
export function apiUrl(path = ""): string {
  if (!path) return API_BASE_URL;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
