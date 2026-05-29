import { test, expect } from '@playwright/test';
import { getBreakpointName, screenshotFileName } from './visualUtils';

test.describe('visual utility helpers', () => {
  test('returns mobile for narrow widths', () => {
    expect(getBreakpointName(375)).toBe('mobile');
  });

  test('returns desktop for wide widths', () => {
    expect(getBreakpointName(1440)).toBe('desktop');
  });

  test('builds a screenshot filename with the correct suffix', () => {
    expect(screenshotFileName('landing-page', 375)).toBe('landing-page-mobile.png');
    expect(screenshotFileName('landing-page', 1440)).toBe('landing-page-desktop.png');
  });
});
