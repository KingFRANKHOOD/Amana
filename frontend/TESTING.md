# Testing Infrastructure

This document describes the testing setup for the frontend application.

## Installed Dependencies

### Testing Libraries
- **jest**: JavaScript testing framework
- **jest-environment-jsdom**: DOM environment for Jest to test React components
- **@types/jest**: TypeScript type definitions for Jest

### React Testing
- **@testing-library/react**: React component testing utilities
- **@testing-library/jest-dom**: Custom Jest matchers for DOM assertions
- **@testing-library/user-event**: User interaction simulation

### Property-Based Testing
- **fast-check**: Property-based testing library for generating test cases

## Configuration

### Jest Configuration (`jest.config.ts`)
- Uses Next.js Jest configuration for seamless integration
- Test environment: jsdom (for DOM testing)
- Coverage provider: v8
- Module name mapping: `@/*` maps to `src/*`
- Setup file: `jest.setup.ts`

### Jest Setup (`jest.setup.ts`)
- Imports `@testing-library/jest-dom` for custom matchers
- Provides matchers like `toBeInTheDocument()`, `toHaveClass()`, etc.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

## Writing Tests

### Visual Regression Tests
Visual snapshot tests live under `tests/visual` and are executed with Playwright.

- `npm run test:visual` runs the snapshot suite.
- `npm run test:visual:update` refreshes failing snapshots after intentional UI changes.

Snapshot tests are structured for both mobile and desktop viewports.

### End-to-End Tests
E2E and coverage specs live under `tests/e2e` and `tests/visual` and run with the
same Playwright command (`npm run test:visual`). They intercept backend calls
with `page.route(...)`, which requires an absolute URL, so the backend origin is
**not** the relative `baseURL`.

Both URLs are environment-configurable:

| Variable | Purpose | Default |
| --- | --- | --- |
| `PLAYWRIGHT_BASE_URL` | Front-end origin under test. When set, the bundled `pnpm dev` server is not started. | `http://localhost:3000` |
| `PLAYWRIGHT_API_URL` | Backend API origin that specs mock. Falls back to `NEXT_PUBLIC_API_URL`, then the default. | `http://localhost:4000` |

Specs must never hardcode the backend origin. Import the shared helper from
`tests/support/api.ts` instead:

```typescript
import { apiUrl } from '../support/api';

await page.route(apiUrl('/trades?**'), handler);
await page.route(apiUrl(`/trades/${tradeId}/evidence`), handler);
```

Run against a different environment:

```bash
PLAYWRIGHT_BASE_URL=https://staging.example.com \
PLAYWRIGHT_API_URL=https://api.staging.example.com \
  npm run test:visual
```

### Unit Tests
Place unit tests in `__tests__` directories next to the components:
```
src/components/Avatar/
├── Avatar.tsx
├── index.ts
└── __tests__/
    ├── Avatar.test.tsx
    └── Avatar.properties.test.tsx
```

### Property-Based Tests
Use fast-check for property-based testing:
```typescript
import fc from 'fast-check';
import { render } from '@testing-library/react';

it('should satisfy property X', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('xs', 'sm', 'md', 'lg', 'xl'),
      (size) => {
        const { container } = render(<Avatar alt="Test" size={size} />);
        // assertions here
      }
    ),
    { numRuns: 100 }
  );
});
```

## Best Practices

1. **Test file naming**: Use `.test.tsx` or `.test.ts` suffix
2. **Property tests**: Run minimum 100 iterations per test
3. **Descriptive names**: Use clear test descriptions
4. **Accessibility**: Test ARIA attributes and semantic HTML
5. **Coverage**: Aim for high coverage of component logic
