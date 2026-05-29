import { expect, test } from '@playwright/test';
import { getViewportForBreakpoint } from './helpers';

test.describe('Visual helper utilities', () => {
  test('returns mobile viewport dimensions', () => {
    expect(getViewportForBreakpoint('mobile')).toEqual({ width: 375, height: 667 });
  });

  test('returns desktop viewport dimensions', () => {
    expect(getViewportForBreakpoint('desktop')).toEqual({ width: 1440, height: 900 });
  });
});
