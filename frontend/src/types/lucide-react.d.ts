declare module 'lucide-react' {
  import { SVGProps, ForwardRefExoticComponent, RefAttributes } from 'react';

  export interface LucideProps extends Partial<SVGProps<SVGSVGElement>> {
    size?: number;
    color?: string;
    strokeWidth?: number;
    absoluteStrokeWidth?: boolean;
  }

  export type LucideIcon = ForwardRefExoticComponent<LucideProps & RefAttributes<SVGSVGElement>>;

  export const icons: Record<string, LucideIcon>;

  export const Activity: LucideIcon;
  export const AlertCircle: LucideIcon;
  export const AlertTriangle: LucideIcon;
  export const ArrowDownToLine: LucideIcon;
  export const ArrowRight: LucideIcon;
  export const ArrowUpFromLine: LucideIcon;
  export const Check: LucideIcon;
  export const CheckCircle: LucideIcon;
  export const CheckCircle2: LucideIcon;
  export const CircleDollarSign: LucideIcon;
  export const Clipboard: LucideIcon;
  export const Clock: LucideIcon;
  export const Copy: LucideIcon;
  export const CreditCard: LucideIcon;
  export const Database: LucideIcon;
  export const Download: LucideIcon;
  export const ExternalLink: LucideIcon;
  export const Eye: LucideIcon;
  export const FileText: LucideIcon;
  export const Fingerprint: LucideIcon;
  export const Flag: LucideIcon;
  export const Info: LucideIcon;
  export const Key: LucideIcon;
  export const Scale: LucideIcon;
  export const Shield: LucideIcon;
  export const ShieldCheck: LucideIcon;
  export const Star: LucideIcon;
  export const Lock: LucideIcon;
  export const Truck: LucideIcon;
  export const Upload: LucideIcon;
  export const Video: LucideIcon;
  export const X: LucideIcon;
  export const RefreshCw: LucideIcon;
  export const XCircle: LucideIcon;
}
