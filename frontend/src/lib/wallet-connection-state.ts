export interface BreadcrumbItem {
  label: string;
  path?: string;
}

function formatLabel(segment: string): string {
  return segment
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function generateBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const segments = pathname.split('/').filter(Boolean);
  const breadcrumbs: BreadcrumbItem[] = [
    {
      label: 'Home',
      path: '/'
    }
  ];

  let currentPath = '';
  for (let i = 0; i < segments.length; i++) {
    currentPath += `/${segments[i]}`;
    const segment = segments[i];
    breadcrumbs.push({
      label: formatLabel(segment),
      path: currentPath
    });
  }

  return breadcrumbs;
}
