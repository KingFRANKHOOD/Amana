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
