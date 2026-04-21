# Frontend Refactoring Issues (Figma Alignment)

Date: 2026-04-21
Context: Refactoring pass based on implemented frontend review versus current design direction.

## Confirmed Correctly Implemented

- Dark green plus gold visual direction is implemented and consistent with product identity.
- Sidebar navigation structure is implemented and functional.
- Trades screen contains required status filters: All, Active, Pending, Completed, Disputed.
- Trades screen includes the Create Trade primary action in the expected area.
- Empty-state handling exists when no trades are returned.
- Trade table and status chips are implemented for populated states.

## Flagged Gaps (Needs Refactor)

- Duplicate header and shell layers are rendered on Trades.
- Shell composition is inconsistent between Trades and Create Trade flows.
- Typography usage is inconsistent with design token intent.
- Root page remains template-like and not product-aligned.
- Spacing and container alignment rhythm is inconsistent across chrome and content.
- Navigation active and hover states are not fully unified.
- Surface and border token usage is mixed and not fully standardized.
- Empty state hierarchy and guidance can be improved.

---

## FE-REF-001 - Refactor to Single App Shell on Trades

Description:
Refactor the Trades experience to use one canonical app shell only. Remove duplicate header and navigation layers so the page structure matches the intended product layout.

Requirements and Context:
- This is a frontend refactoring issue (Priority: P0).
- Scope includes layout unification between app chrome and Trades content.
- Figma Link: https://www.figma.com/design/r4l1ciQ2AnyrOxVW9t5oCm/Amana?node-id=0-1&t=1MBz2FGXTfJSQ8ma-1
- Affected files:
	- frontend/src/app/layout.tsx
	- frontend/src/components/Shell.tsx
	- frontend/src/app/trades/page.tsx

Acceptance Criteria:
- [ ] Trades renders with exactly one top-level app chrome.
- [ ] No duplicate logo/title/nav bars remain.
- [ ] Sidebar, top bar, and content alignment are consistent.

Deliverables:
- [ ] Implementation of the above criteria.
- [ ] Proof of correct behavior (screenshots and/or QA notes).

NOTE:
This issue will not be reviewed or approved without screenshot evidence demonstrating that duplicate shell/header layers were removed.

Suggested Execution:
1. Remove page-level shell duplication from Trades route.
2. Keep only canonical app layout chrome.
3. Validate spacing/alignment against Figma.

Guidelines:
- Follow existing frontend conventions.
- Keep refactor scoped to layout concerns.
- Add before/after screenshots in PR.

---

## FE-REF-002 - Unify Navigation States Across App Chrome

Description:
Refactor sidebar, top nav, and tab interactions so active, hover, and focus states are visually and behaviorally consistent.

Requirements and Context:
- This is a frontend refactoring issue (Priority: P0).
- Scope covers interaction consistency and accessibility for navigation.
- Figma Link: https://www.figma.com/design/r4l1ciQ2AnyrOxVW9t5oCm/Amana?node-id=0-1&t=1MBz2FGXTfJSQ8ma-1
- Affected files:
	- frontend/src/components/layout/AppTopNav.tsx
	- frontend/src/components/layout/SideNavBar.tsx
	- frontend/src/app/trades/page.tsx

Acceptance Criteria:
- [ ] Active states use one consistent visual pattern.
- [ ] Hover and focus treatments are consistent and keyboard-visible.
- [ ] No conflicting styles remain between nav regions.

Deliverables:
- [ ] Implementation of the above criteria.
- [ ] Proof of correct behavior (screenshots and/or QA notes).

NOTE:
This issue will not be reviewed or approved without screenshots showing default, hover, active, and focus states.

Suggested Execution:
1. Define one navigation state pattern from Figma.
2. Apply to sidebar, top nav, and trades tabs.
3. Verify keyboard navigation and visual parity.

Guidelines:
- Preserve existing routing behavior.
- Do not regress accessibility.
- Add state screenshots in PR.

---

## FE-REF-003 - Standardize Typography Tokens and Hierarchy

Description:
Refactor typography usage so headings, body text, metadata, and nav labels follow one consistent tokenized hierarchy.

Requirements and Context:
- This is a frontend refactoring issue (Priority: P1).
- Scope covers token usage and hierarchy consistency.
- Figma Link: https://www.figma.com/design/r4l1ciQ2AnyrOxVW9t5oCm/Amana?node-id=0-1&t=1MBz2FGXTfJSQ8ma-1
- Affected files:
	- frontend/src/app/layout.tsx
	- frontend/src/app/globals.css
	- frontend/src/components/TopNav.tsx
	- frontend/src/app/trades/page.tsx

Acceptance Criteria:
- [ ] Typography uses approved tokenized families and sizes.
- [ ] Heading/body/supporting hierarchy is coherent.
- [ ] Unintended fallback stack usage is removed.

Deliverables:
- [ ] Implementation of the above criteria.
- [ ] Proof of correct behavior (screenshots and/or QA notes).

NOTE:
This issue will not be reviewed or approved without screenshots that clearly show typography hierarchy before and after.

Suggested Execution:
1. Audit and map current typography to Figma scale.
2. Update tokens and component usage.
3. Verify hierarchy in top nav and trades views.

Guidelines:
- Use token-driven classes only.
- Avoid ad-hoc font overrides.
- Attach close-up typography screenshots in PR.

---

## FE-REF-004 - Refactor Spacing and Layout Grid Consistency

Description:
Refactor spacing and grid alignment across app bars, sidebar, content gutters, and tab row to create one consistent layout rhythm.

Requirements and Context:
- This is a frontend refactoring issue (Priority: P1).
- Scope focuses on spacing scale and structural alignment.
- Figma Link: https://www.figma.com/design/r4l1ciQ2AnyrOxVW9t5oCm/Amana?node-id=0-1&t=1MBz2FGXTfJSQ8ma-1
- Affected files:
	- frontend/src/components/TopNav.tsx
	- frontend/src/components/layout/AppTopNav.tsx
	- frontend/src/app/trades/page.tsx

Acceptance Criteria:
- [ ] Container gutters align across shell and content.
- [ ] Vertical spacing follows one spacing scale.
- [ ] Header and content columns align consistently.

Deliverables:
- [ ] Implementation of the above criteria.
- [ ] Proof of correct behavior (screenshots and/or QA notes).

NOTE:
This issue will not be reviewed or approved without desktop and mobile screenshots proving spacing and alignment consistency.

Suggested Execution:
1. Establish spacing baseline from Figma.
2. Apply spacing tokens to top bars, tabs, and content blocks.
3. Validate desktop and mobile breakpoints.

Guidelines:
- Keep changes token-based.
- Preserve responsive behavior.
- Add before/after desktop and mobile screenshots.

---

## FE-REF-005 - Normalize Surface, Border, and Elevation Tokens

Description:
Refactor surfaces, borders, and elevation styles to remove ad-hoc values and enforce consistent token-based visual layering.

Requirements and Context:
- This is a frontend refactoring issue (Priority: P1).
- Scope includes table surfaces, status chips, and sidebar chrome.
- Figma Link: https://www.figma.com/design/r4l1ciQ2AnyrOxVW9t5oCm/Amana?node-id=0-1&t=1MBz2FGXTfJSQ8ma-1
- Affected files:
	- frontend/tailwind.config.ts
	- frontend/src/app/trades/page.tsx
	- frontend/src/components/layout/SideNavBar.tsx

Acceptance Criteria:
- [ ] Surface layering is consistent and predictable.
- [ ] Border and elevation treatments are token-driven.
- [ ] Status indicators remain readable and consistent.

Deliverables:
- [ ] Implementation of the above criteria.
- [ ] Proof of correct behavior (screenshots and/or QA notes).

NOTE:
This issue will not be reviewed or approved without screenshots of rows, chips, and selected states showing token normalization.

Suggested Execution:
1. Audit conflicting surface/border/elevation styles.
2. Map all to approved tokens.
3. Validate contrast and state consistency.

Guidelines:
- Avoid one-off colors in components.
- Maintain accessibility and readability.
- Add focused visual comparison screenshots.

---

## FE-REF-006 - Improve Trades Empty State UX and Guidance

Description:
Refactor the empty state on Trades for better messaging, hierarchy, and clear next-action guidance.

Requirements and Context:
- This is a frontend refactoring issue (Priority: P2).
- Scope is limited to empty-state UX on Trades.
- Figma Link: https://www.figma.com/design/r4l1ciQ2AnyrOxVW9t5oCm/Amana?node-id=0-1&t=1MBz2FGXTfJSQ8ma-1
- Affected files:
	- frontend/src/app/trades/page.tsx

Acceptance Criteria:
- [ ] Empty state clearly communicates context.
- [ ] Empty state provides clear action guidance.
- [ ] Visual hierarchy aligns with page system.

Deliverables:
- [ ] Implementation of the above criteria.
- [ ] Proof of correct behavior (screenshots and/or QA notes).

NOTE:
This issue will not be reviewed or approved without before/after screenshots of the empty state and action guidance.

Suggested Execution:
1. Refine empty-state copy and supporting content.
2. Keep CTA prominence aligned with Figma.
3. Validate hierarchy and spacing.

Guidelines:
- Keep messaging concise.
- Ensure CTA remains obvious.
- Add before/after screenshots in PR.

---

## FE-REF-007 - Replace Root Template Page with Product-Aligned Entry

Description:
Refactor the root page by replacing template/demo content with a product-aligned entry experience that matches app design language.

Requirements and Context:
- This is a frontend refactoring issue (Priority: P1).
- Scope includes root page structure and visual consistency.
- Figma Link: https://www.figma.com/design/r4l1ciQ2AnyrOxVW9t5oCm/Amana?node-id=0-1&t=1MBz2FGXTfJSQ8ma-1
- Affected files:
	- frontend/src/app/page.tsx

Acceptance Criteria:
- [ ] Template/demo content is fully removed.
- [ ] Root page matches product shell and visual language.
- [ ] Navigation to core flows is clear.

Deliverables:
- [ ] Implementation of the above criteria.
- [ ] Proof of correct behavior (screenshots and/or QA notes).

NOTE:
This issue will not be reviewed or approved without desktop and mobile screenshots proving final behavior.

Suggested Execution:
1. Remove template assets and placeholders.
2. Implement product-aligned entry layout from Figma.
3. Validate responsiveness and navigation clarity.

Guidelines:
- Keep page production-ready.
- Reuse existing design tokens and components.
- Attach desktop/mobile screenshots in PR.

---

## Merge Gate for All Refactoring Issues

For every issue above, screenshot evidence is a required merge gate. Any PR without screenshots of completed work should be considered incomplete and blocked from merge.
