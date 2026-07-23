#873 MEDIUM: Mobile — outdated deps with CVEs and no test framework configured
Repo Avatar
KingFRANKHOOD/Amana
﻿File: mobile/package.json

Issues:

axios ^1.6.8 has known high-severity vulnerabilities (SSRF, ReDoS, credential leaks)
react ^18.3.1 is outdated — current stable is React 19.x
react-native 0.76.2 is outdated
No test framework configured (no Jest/Vitest/Detox in devDependencies) — existing issue #634 confirms this
Severity: Medium
Category: Dependencies / Testing

Suggested Fix:

Update axios to >=1.16.0
Update react and react-native to current stable
Add Jest + React Native Testing Library for unit tests

#872 LOW: Backend — eventListener outbox detection uses fragile runtime type introspection
Repo Avatar
KingFRANKHOOD/Amana
﻿File: backend/src/services/eventListener.service.ts:266-274

Description
The supportsOutboxPersistence() method uses unsafe type introspection to detect if the chainEventOutbox model exists at runtime:

const outbox = (this.prisma as unknown as Record<string, unknown>)["chainEventOutbox"];
return Boolean(outbox && typeof (outbox as any).findUnique === "function");
This is fragile — if Prisma changes its internal proxy structure (e.g., between 5.x minor versions), this silently returns false and falls back to the non-outbox path. No log message or warning is emitted when the feature is unavailable.

Severity: Low
Category: Quality / Refactor

Suggested Fix: Either make the outbox feature compile-time (conditional import via separate build) or log a warning when the feature is unavailable.



#870 MEDIUM: Frontend — trade detail page renders [object Object] and has no loading state
Repo Avatar
KingFRANKHOOD/Amana
﻿File: frontend/src/app/trades/[id]/page.tsx

Issues:

[object Object] rendering — nested objects are rendered directly with {event.details} in JSX
No loading.tsx fallback for the trade detail page — navigation shows blank screen until data loads
Error handling for invalid trade IDs may show generic error instead of "trade not found"
Severity: Medium
Category: Bug / UX

Suggested Fix:

Use JSON.stringify(event.details) or a proper details component
Add loading.tsx with skeleton UI
Handle 404 responses specifically from the trade detail API

#871 MEDIUM: Frontend — useAuth hook conflates wallet, auth, and user concerns (hard to test)
Repo Avatar
KingFRANKHOOD/Amana
﻿File: frontend/src/hooks/useAuth.tsx

Description
The useAuth hook returns 12+ properties mixing three concerns:

Wallet state (isWalletConnected, address)
Auth state (token, isAuthenticated)
Actions (connectWallet, authenticate, logout)
This makes it hard to test and creates unnecessary re-renders when any sub-state changes. Tests mock at the hook level instead of the wallet API level, missing regressions in wallet integration.

Severity: Medium
Category: Refactor

Suggested Fix: Split into useWallet (wallet connection), useAuth (JWT lifecycle), and compose them. Test against the wallet API mock, not the hook internals.


