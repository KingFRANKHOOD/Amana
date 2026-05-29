export type Breakpoint = 'mobile' | 'desktop';

export function getViewportForBreakpoint(breakpoint: Breakpoint) {
  const viewports = {
    mobile: { width: 375, height: 667 },
    desktop: { width: 1440, height: 900 },
  } as const;

  return viewports[breakpoint];
}
