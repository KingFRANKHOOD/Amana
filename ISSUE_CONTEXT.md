# GitHub Issues to Resolve

**Upstream:** KingFRANKHOOD/Amana
**Issues:** #467, #469, #472, #480
**Generated:** 2026-04-27T21:06:51.574Z

---

## 🤖 COPILOT PROMPT (copy into Copilot Chat)

```
@workspace You are working on a live production repository.

Your task is to resolve multiple GitHub issues in a SINGLE branch and PR.

Issues:
#467 - CI-002 - Add frontend visual tests to required status gate
#469 - TEST-001 - Standardize backend tests on one framework (Jest or Vitest)
#472 - DB-002 - Strengthen destructive migration scanner patterns
#480 - QA-001 - Create flaky-test quarantine and retry policy

Read the full issue details in ISSUE_CONTEXT.md

PR description draft file:
undefined

Execution rules:
- First, analyze ALL issues together before coding
- Identify overlapping logic or shared dependencies
- Group related fixes to avoid duplication
- Do NOT mix unrelated logic across files unnecessarily

Step-by-step process:

STEP 1: ANALYSIS
- Explain root cause of each issue
- List affected files per issue
- Identify shared files across issues

STEP 2: PLAN
- Define order of implementation
- Explain why this order avoids regressions

STEP 3: IMPLEMENTATION
- Apply fixes incrementally
- Keep each issue logically isolated in code
- Prefer small reusable functions over duplication

STEP 4: SAFETY CHECK
- Ensure:
  - No broken imports
  - No type/runtime errors
  - No UI regressions
  - API contracts unchanged

STEP 5: TESTING
- Suggest manual test steps
- Suggest edge cases

STEP 6: PR OUTPUT
Generate commit messages per issue and update undefined with a complete PR description:
Closes KingFRANKHOOD/Amana#467
Closes KingFRANKHOOD/Amana#469
Closes KingFRANKHOOD/Amana#472
Closes KingFRANKHOOD/Amana#480

Additional mandatory rules:
- Never include "Made with Cursor" or any tool/vendor footer in commit message or PR description.
- Use Conventional Commits style subjects that describe work done (not only issue number).
- Ensure every issue has a correct closing tag in PR description, for example: Closes KingFRANKHOOD/Amana#<issue-number>.

Important:
If any issue is ambiguous, ask for clarification BEFORE implementing.
```

---

## 📋 ISSUE DETAILS

### Issue #467: CI-002 - Add frontend visual tests to required status gate
**URL:** https://github.com/KingFRANKHOOD/Amana/issues/467
**Labels:** Stellar Wave

## Summary
Include frontend visual regression tests in the required status gate before merge.

## Why
Visual regressions can pass unnoticed when visual jobs are not part of the final gate.

## Scope
- Add frontend-visual to final status gate dependencies.
- Ensure visual failures fail the merge gate.
- Keep artifact uploads for diagnosis.

## Acceptance Criteria
- Final gate depends on visual test job result.
- PR fails when visual tests fail.
- Visual artifact upload behavior remains intact.


---

### Issue #469: TEST-001 - Standardize backend tests on one framework (Jest or Vitest)
**URL:** https://github.com/KingFRANKHOOD/Amana/issues/469
**Labels:** Stellar Wave

## Summary
Standardize backend tests on a single framework and remove mixed-runner usage.

## Why
Mixing Jest and Vitest in backend tests causes instability and maintenance overhead.

## Scope
- Select canonical backend test runner.
- Migrate outlier suites/imports to canonical runner.
- Update scripts and contributor guidance.

## Acceptance Criteria
- Backend tests use one framework consistently.
- No backend tests import the non-canonical runner.
- Full backend test command passes in CI with the new standard.


---

### Issue #472: DB-002 - Strengthen destructive migration scanner patterns
**URL:** https://github.com/KingFRANKHOOD/Amana/issues/472
**Labels:** Stellar Wave

## Summary
Strengthen destructive migration detection rules in migration safety scanning.

## Why
Limited detection patterns can miss high-risk schema changes.

## Scope
- Expand risky DDL pattern coverage beyond current checks.
- Add tests/examples for detection correctness.
- Document escalation/approval behavior for risky migrations.

## Acceptance Criteria
- Scanner detects a broader set of destructive or risky DDL patterns.
- Detection logic has automated tests.
- Migration policy docs reflect new rule set.


---

### Issue #480: QA-001 - Create flaky-test quarantine and retry policy
**URL:** https://github.com/KingFRANKHOOD/Amana/issues/480
**Labels:** Stellar Wave

## Summary
Create a flaky-test quarantine and retry policy to preserve CI signal quality as test volume grows.

## Why
Flaky tests erode confidence in CI and slow delivery when failures are non-deterministic.

## Scope
- Define flaky test identification and quarantine process.
- Define bounded retry strategy in CI.
- Require owners and expiry dates for quarantined tests.

## Acceptance Criteria
- Flaky policy doc is published and adopted.
- CI retry behavior is explicit and bounded.
- Quarantined tests are tracked with owner and expiry metadata.


## 📝 COMMIT MESSAGE
```
fix: resolve issues #467, #469, #472, #480

- #467: CI-002 - Add frontend visual tests to required status gate
- #469: TEST-001 - Standardize backend tests on one framework (Jest or Vitest)
- #472: DB-002 - Strengthen destructive migration scanner patterns
- #480: QA-001 - Flaky-test quarantine and bounded CI retries

Closes KingFRANKHOOD/Amana#467
Closes KingFRANKHOOD/Amana#469
Closes KingFRANKHOOD/Amana#472
Closes KingFRANKHOOD/Amana#480
```
