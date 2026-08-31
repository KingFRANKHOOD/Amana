# Frontend Security Headers

**Issue Reference:** #1091 — Frontend Missing Content Security Policy Headers  
**Implementation:** `frontend/src/middleware.ts`, `frontend/next.config.ts`

---

## Overview

The Amana frontend enforces a defence-in-depth set of HTTP security headers on every page response. Headers are applied at two layers:

| Layer | File | Scope |
|-------|------|-------|
| Edge middleware | `src/middleware.ts` | All HTML pages — generates a per-request nonce for the CSP |
| Next.js `headers()` | `next.config.ts` | All routes including static assets — baseline hardening |

The middleware CSP takes precedence over the static headers block for HTML pages.

---

## Content Security Policy (CSP)

### Why nonce-based?

Next.js App Router generates inline `<script>` tags as part of its bootstrap process. These cannot be allowed via `'unsafe-inline'` (which would defeat the entire point of a CSP) and cannot easily be hashed because the hash changes on every build.

The correct solution is a **per-request nonce**:

1. The middleware generates a cryptographically random 32-character hex nonce on every request.
2. The nonce is embedded in the `script-src` directive: `'nonce-<nonce>'`.
3. The nonce is also forwarded to the React render tree via the `x-nonce` request header.
4. `app/layout.tsx` reads the nonce and attaches it to inline `<script>` elements.

With `'strict-dynamic'` in `script-src`, any script loaded by a nonce-carrying script is also trusted — this allows Next.js to hydrate the page without requiring individual nonces on every chunk.

### Directives

| Directive       | Value | Rationale |
|-----------------|-------|-----------|
| `default-src`   | `'self'` | Deny-by-default for all resource types |
| `script-src`    | `'self' 'strict-dynamic' 'nonce-<n>'` | Nonce allows Next.js inline; strict-dynamic trusts loaded scripts |
| `style-src`     | `'self' 'unsafe-inline'` | Required for Tailwind CSS-in-JS and Next.js style injection. Hash-based hardening is a future item. |
| `img-src`       | `'self' data: https://ipfs.io https://*.pinata.cloud` | Local images + IPFS evidence uploads displayed inline |
| `connect-src`   | `'self' https://api.stellar.org https://horizon.stellar.org https://horizon-testnet.stellar.org` | Stellar Horizon API (mainnet + testnet) for wallet and escrow calls |
| `font-src`      | `'self'` | Web fonts loaded locally (no external font CDNs) |
| `frame-src`     | `'none'` | No iframes used in the app |
| `object-src`    | `'none'` | No plugins |
| `base-uri`      | `'self'` | Prevents `<base>` tag injection attacks |
| `form-action`   | `'self'` | Form submissions only to same origin |
| `frame-ancestors` | `'none'` | Prevents clickjacking via embedding |
| `report-uri`    | `$NEXT_PUBLIC_API_URL/api/v1/csp-violation` | Backend violation collection for Grafana monitoring |

### Why not `report-only` mode?

`'strict-dynamic'` + nonce is required for Next.js App Router to function at all. There is no meaningful report-only transition state — if the nonce is missing or incorrect, the page simply breaks. The policy ships in enforce mode from day one. Future CSP changes to `style-src` may be staged through report-only.

---

## Additional Security Headers

These headers are set by both the middleware and the `next.config.ts` `headers()` block:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type confusion attacks |
| `X-Frame-Options` | `DENY` | Belt-and-suspenders clickjacking protection (redundant with `frame-ancestors 'none'` for old browsers) |
| `X-XSS-Protection` | `1; mode=block` | Legacy XSS filter for older browsers |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | Forces HTTPS for 1 year; enables HSTS preloading |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Sends origin only on cross-origin navigations |
| `Permissions-Policy` | (see below) | Disables all browser APIs the app does not use |
| `Cross-Origin-Opener-Policy` | `same-origin` | Mitigates Spectre-class side-channel attacks |
| `Cross-Origin-Resource-Policy` | `same-origin` | Prevents cross-origin reads of responses |
| `X-DNS-Prefetch-Control` | `off` | Prevents leaking visited URLs via DNS |

### Permissions-Policy

All API features are disabled (`()`):

```
accelerometer=(), ambient-light-sensor=(), autoplay=(), battery=(), camera=(),
cross-origin-isolated=(), display-capture=(), document-domain=(),
encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(),
keyboard-map=(), magnetometer=(), microphone=(), midi=(), payment=(),
picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(),
sync-xhr=(), usb=(), web-share=(), xr-spatial-tracking=()
```

If a future feature requires a browser API (e.g. camera for PoD video upload), add the specific origin to the policy in `src/middleware.ts` and update this document.

---

## Backend Parity

The CSP directives mirror those set by the backend's Helmet configuration in `backend/src/app.ts`. Both surfaces enforce:

- `default-src 'self'`
- `img-src 'self' data: https://ipfs.io https://*.pinata.cloud`
- `connect-src 'self' <Stellar endpoints>`
- `frame-src 'none'`
- `object-src 'none'`
- `frame-ancestors 'none'`
- `report-uri /api/v1/csp-violation`

The frontend additionally uses a nonce for `script-src` (required for App Router), which the backend API does not need.

---

## CSP Violation Reporting

Violations are reported to the backend's `/api/v1/csp-violation` endpoint, collected by `backend/src/routes/csp.routes.ts`, and stored in the `csp_violations` Prometheus counter (`cspMetrics.ts`). View them in Grafana under the `amana-error-monitoring` dashboard.

Configure the report endpoint via:

```env
# frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:4000
```

---

## Testing

The middleware logic is unit-tested in `frontend/src/__tests__/middleware.test.ts`. Run:

```bash
cd frontend
pnpm test middleware
```

Tests cover:
- `generateNonce` — 32-char hex, unique per call
- `buildCsp` — all required directives present, nonce embedded, report-uri conditional on env var
- `middleware()` — every security header set, nonce is unique per request, nonce appears in CSP

---

## Maintenance

- **Adding a new trusted script source:** Add to `script-src` in `buildCsp()` in `src/middleware.ts`. Do **not** add `'unsafe-inline'`.
- **Adding a new image host:** Add to `img-src` in `buildCsp()`.
- **Adding a new connect-src endpoint:** Add to `connect-src` in `buildCsp()` for Stellar or other APIs.
- **Enabling a browser API:** Add the feature to `Permissions-Policy` in `middleware()` with the allowed origin.
- **Testing policy changes:** Run `pnpm test middleware` and verify CSP directives in browser DevTools → Network → Response Headers.

---

## Related

- `frontend/src/middleware.ts` — implementation
- `frontend/next.config.ts` — static headers fallback
- `backend/src/app.ts` — backend Helmet CSP (should remain in sync with frontend)
- `backend/src/routes/csp.routes.ts` — violation report endpoint
- `docs/security/xss-audit.md` — XSS audit findings
- `docs/threat-model.md` — overall threat model
