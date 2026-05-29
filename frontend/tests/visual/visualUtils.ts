export type BreakpointName = 'mobile' | 'desktop';

export function getBreakpointName(width: number): BreakpointName {
  return width <= 768 ? 'mobile' : 'desktop';
}

export function screenshotFileName(baseName: string, width: number): string {
  return `${baseName}-${getBreakpointName(width)}.png`;
}
