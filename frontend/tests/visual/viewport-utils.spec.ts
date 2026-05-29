import { test, expect } from '@playwright/test';
import { breakpoints, getBreakpointName, isSupportedBreakpoint } from './viewport-utils';

test.describe('viewport utilities', () => {
  test('should recognize the mobile breakpoint', () => {
    expect(getBreakpointName(breakpoints.mobile.width, breakpoints.mobile.height)).toBe('mobile');
    expect(isSupportedBreakpoint(breakpoints.mobile.width, breakpoints.mobile.height)).toBe(true);
  });

  test('should recognize the desktop breakpoint', () => {
    expect(getBreakpointName(breakpoints.desktop.width, breakpoints.desktop.height)).toBe('desktop');
    expect(isSupportedBreakpoint(breakpoints.desktop.width, breakpoints.desktop.height)).toBe(true);
  });

  test('should return unsupported for unknown viewport sizes', () => {
    expect(getBreakpointName(800, 600)).toBe('unsupported');
    expect(isSupportedBreakpoint(800, 600)).toBe(false);
  });
});
