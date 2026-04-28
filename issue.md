#351 FE-REF-002 - Implement Consistent Navigation State System
Repo Avatar
KingFRANKHOOD/Amana
﻿Description:
Implement navigation interaction states (active, hover, focus) per Figma design system. The Figma defines consistent patterns for nav state feedback. Align sidebar, top nav, and tabs to one unified state pattern.

Requirements and Context:

This is a frontend refactoring issue (Priority: P0).
Scope covers interaction consistency and accessibility for navigation.
Figma Link: https://www.figma.com/design/r4l1ciQ2AnyrOxVW9t5oCm/Amana?node-id=0-1&t=1MBz2FGXTfJSQ8ma-1
Affected files:
frontend/src/components/layout/AppTopNav.tsx
frontend/src/components/layout/SideNavBar.tsx
frontend/src/app/trades/page.tsx
Acceptance Criteria:

 Active states use one consistent visual pattern.
 Hover and focus treatments are consistent and keyboard-visible.
 No conflicting styles remain between nav regions.
Deliverables:

 Implementation of the above criteria.
 Proof of correct behavior (screenshots and/or QA notes).
NOTE:
This issue will not be reviewed or approved without screenshots showing default, hover, active, and focus states.

Suggested Execution:

Fork and create a branch:
git checkout -b refactor/fe-ref-002-unify-nav-states
In affected files, standardize active/hover/focus states:

frontend/src/components/layout/AppTopNav.tsx
frontend/src/components/layout/SideNavBar.tsx
frontend/src/app/trades/page.tsx
Tests/proof required:

 Screenshot: default nav state
 Screenshot: hover nav state
 Screenshot: active and keyboard focus states
Example commit message:

refactor(frontend): standardize navigation interaction states across app chrome
Guidelines:

Preserve existing routing behavior.
Do not regress accessibility.
Add state screenshots in PR.
