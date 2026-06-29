# Accessibility Audit Report — WCAG 2.1 AA

**Date:** 2026-06-29  
**Auditor:** Mubking-dev  
**Scope:** `frontend/src/components/`  
**Standard:** WCAG 2.1 AA  
**Tool:** jest-axe (axe-core)

## Summary

| Component | Status | Violations Found | Fixed |
|-----------|--------|-----------------|-------|
| Button | ✅ Pass | 0 | — |
| FormField | ✅ Pass | 0 | — |
| Tabs | ✅ Pass (after fix) | 1 | ✅ |
| Badge | ✅ Pass | 0 | — |
| StatusBadge | ✅ Pass | 0 | — |
| TradeListItem | ✅ Pass | 0 | — |

**All 14 automated axe-core tests pass.**

## Violations Fixed

### Tabs — Missing `role="tablist"` on wrapper (`aria-required-parent`)
- **File:** `src/components/ui/Tabs.tsx`
- **Rule:** `aria-required-parent` (WCAG 1.3.1 — Info and Relationships)
- **Severity:** Critical
- **Issue:** Tab buttons had `role="tab"` but their parent `<div>` lacked `role="tablist"`, making the tab structure invalid for assistive technologies.
- **Fix:** Added `role="tablist"` to the wrapper `<div>` in both underline and bordered variants.

```tsx
// Before
<div className={`flex gap-2 ...`}>

// After
<div role="tablist" className={`flex gap-2 ...`}>
```

## Components with No Violations

- **Button** — All variants (primary, secondary, disabled) pass. Focus indicators present via `focus-visible:outline`.
- **FormField** — Correct `<label>` association via `htmlFor`, `aria-describedby` for hints and errors, `aria-invalid` in error state.
- **Badge** — Semantic inline element, no role issues.
- **StatusBadge** — Icon + label combination is accessible.
- **TradeListItem** — Action buttons (View, Deposit, Withdraw) are keyboard accessible with visible labels.

## Known Limitations

- Color contrast could not be fully verified by axe-core in jsdom (no computed styles). Manual verification recommended for gold-on-dark color scheme.
- Screen reader testing (VoiceOver/NVDA) on Trade Dashboard and Create Trade flows requires a browser environment and should be performed manually.

## Test Location

`frontend/src/__tests__/accessibility/components.axe.test.tsx`

Run with:
```bash
npx jest src/__tests__/accessibility/components.axe.test.tsx
```
