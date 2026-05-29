# Snapshot Policy

## When to regenerate snapshots

Regenerate snapshots **only** when there is an intentional visual change — for example, a design update, a layout refactor, or a new UI state. Run:

```bash
pnpm test:visual:update
```

Then commit the updated `.png` files in the same PR as the code change that caused them.

## When NOT to regenerate

Do not regenerate snapshots to silence a failing test. A snapshot diff that is not caused by your PR is a signal of an unrelated regression — investigate it instead of overwriting it.

## Reviewing snapshot diffs in PRs

- Rendered PNG diffs will appear in the Playwright HTML report (`playwright-report/`).
- A diff that touches only the scoped element (e.g. `landing-header.png`) is expected when the header changed.
- A diff that touches a large region when only a small component changed is a sign the snapshot is too broad — tighten the locator.

## Keeping snapshots scoped

Each `toHaveScreenshot` call should target the smallest stable DOM region that proves the assertion. Prefer `page.locator('header')` or `page.locator('main')` over `{ fullPage: true }`. Full-page screenshots generate large binary diffs that obscure the meaningful change for reviewers.

## Adding new snapshots

When adding a new visual test:

1. Use a named locator (e.g. `page.locator('[data-testid="hero"]')`).
2. Run `pnpm test:visual:update` once to generate the baseline.
3. Commit the baseline PNG alongside the test file in the same PR.
4. Do not commit PNGs without a corresponding test change.
