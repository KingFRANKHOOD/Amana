import { Skeleton } from "./Skeleton";

type SkeletonListProps = {
  rows?: number;
  className?: string;
};

export function SkeletonList({ rows = 4, className }: SkeletonListProps) {
  return (
    <div className={`space-y-3 ${className ?? ""}`} aria-busy="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="rounded-lg border border-border-default bg-card px-4 py-3"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3 w-2/5" />
              <Skeleton className="h-3 w-4/5" />
            </div>
            <Skeleton className="h-7 w-20 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
