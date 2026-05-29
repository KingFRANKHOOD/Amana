## Summary
Unifies navigation interaction states across App Top Nav, Sidebar Nav, and Trades filter tabs using one consistent active, hover, and keyboard focus-visible pattern.

## Changes
- Standardized active state to elevated surface + gold text treatment.
- Standardized hover state to surface lift + text contrast treatment.
- Standardized keyboard focus-visible outline behavior across nav regions.

## Validation
- `npm --prefix frontend run lint` (fails due to pre-existing repo lint errors unrelated to this issue)
- `npm --prefix frontend run test` (fails due to pre-existing test failures unrelated to this issue)
- `npm --prefix frontend run build` (fails due to pre-existing build/environment issues unrelated to this issue)

## QA Notes
- Verified routes and `aria-current` behavior remain intact.
- Please attach screenshots for default, hover, active, and focus states in PR review.

closes #351
