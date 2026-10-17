# XSS audit

Audit scope: `frontend/src`, completed for issue #1056.

## Findings

- Authentication credentials are no longer written to Web Storage, exposed
  through React state, or assembled into `Authorization` headers. Browser API
  calls use `credentials: "include"` and the server owns both JWT cookies.
- The toast component's static keyframe CSS no longer uses
  `dangerouslySetInnerHTML`.
- The only remaining `dangerouslySetInnerHTML` call is the static theme
  bootstrap in `app/layout.tsx`. Its source is a repository constant and it
  interpolates no request, URL, storage, or user-controlled content. It is
  authorized by the per-request CSP nonce generated in `proxy.ts`.
- Searches found no rendering of API or user-provided HTML. User-controlled
  values are rendered through normal React text nodes.

## Required invariant

Do not pass API data, URL parameters, wallet metadata, or other dynamic values
to `dangerouslySetInnerHTML`. Any future exception requires sanitization, a
documented threat review, and a CSP-compatible implementation.
