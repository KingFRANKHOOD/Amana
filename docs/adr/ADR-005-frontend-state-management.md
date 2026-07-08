# ADR-005: Frontend State Management

## Status

Accepted (implemented in `frontend/src/stores/`, `frontend/src/hooks/useAuth.tsx`,
`frontend/src/lib/api/`).

## Context

The frontend (Next.js 16 App Router, React 19) needs to manage three
distinct kinds of state that don't naturally belong to the same mechanism:

1. **Server-mirrored data** - trades fetched from the backend, which can
   go stale, need pagination/filtering, and benefit from optimistic UI
   updates on mutation (see [docs/api/trades.md](../api/trades.md)).
2. **Client-only UI preferences** - sidebar collapsed state, preferred
   currency display - things with no server representation at all, that
   should survive a page reload.
3. **Auth/session state** - the wallet connection and JWT, which is
   security-sensitive and used by nearly every component, but isn't
   "application data" in the same sense as trades.

We deliberately did not add a server-cache library (React Query, SWR) -
`frontend/package.json` has no such dependency today.

## Decision

**Zustand (`create`) for both server-mirrored and client-only state**,
but used differently for each:

- **`useTradeStore`**: holds the fetched `trades` array, `page`,
  `filters`, `isLoading`/`error`, and actions (`fetchTrades`, `setPage`,
  `setFilter`) that call `tradesApi` directly and write the result into
  the store. There is no separate cache layer, no automatic
  revalidation-on-focus, and no query-key-based invalidation - the store
  *is* the cache, and it's invalidated by explicitly calling `fetchTrades`
  again (e.g. after `setPage`/`setFilter`).
- **Optimistic mutations with manual rollback**: `updateTrade`/
  `removeTrade` apply the change to local state immediately, then run an
  optional `serverFn` callback; if `serverFn` rejects, the store restores
  the pre-mutation snapshot it captured before optimistically updating.
  This is done by hand (capture `prev`, mutate, revert on catch) rather
  than via a library's built-in optimistic-update/rollback primitive.
- **`useUIStore`**: client-only preferences (`sidebarCollapsed`,
  `currencyDisplay`, `theme`), wrapped in zustand's `persist` middleware so
  they survive a reload. This store has no server interaction at all and
  no reason to ever need one.

**Auth is a React Context (`useAuth`/`AuthContextType`), not a zustand
store.** It wraps Freighter wallet integration (`@stellar/freighter-api`:
`getAddress`, `isConnected`, `signMessage`, etc.) and the challenge/verify
flow (`docs/api/overview.md#authentication`), and holds `address`, `token`,
and connection/loading state. The JWT is persisted directly to
`localStorage` under a fixed key rather than through the `zustand/persist`
middleware used for `uiStore` - auth predates (or was deliberately kept
separate from) the zustand-based stores, and mixing security-sensitive
session state into the same store family as UI preferences wasn't judged
worth the consistency gain.

**Data-fetching hooks (`useTradeDetail`, `useTradeDetails`, etc.) wrap
individual API calls in plain React state**, independent of the zustand
stores, for data that's fetched once per view rather than needing the
shared, mutable, list-level state a store provides.

## Consequences

- **Positive:** No extra dependency, and no cache-key/staleness model to
  learn beyond "call the fetch action again when you need fresh data" -
  for a codebase of this size, the manual model in `useTradeStore` is
  simple to reason about end to end.
- **Positive:** Optimistic updates are explicit and visible in the store
  code (`updateTrade`/`removeTrade`), rather than hidden behind a library's
  mutation lifecycle - easy to see exactly what happens on failure.
- **Negative:** Every consumer of trade data re-fetches through the same
  store rather than getting automatic dedup/sharing across independent
  `useQuery`-style calls a library would provide - two components needing
  the same data both go through `useTradeStore`, which is fine as long as
  there's exactly one canonical store per resource, but doesn't generalize
  automatically to a new resource without writing a new store by hand.
- **Negative:** No automatic revalidation (on refetch-on-focus,
  refetch-on-reconnect, background polling) - staleness is only resolved
  when something explicitly calls a fetch action again. `useOffline`
  exists as a separate hook to at least detect connectivity changes, but
  reconnection doesn't automatically trigger a re-fetch today.
- **Negative:** Splitting auth (Context) from app data (zustand) means two
  different state-access patterns exist side by side
  (`useAuth()` vs. `useTradeStore()`) - a new contributor has to learn
  both rather than one consistent pattern, and there's no written rule
  captured elsewhere for which one a new piece of state should use before
  this ADR.
