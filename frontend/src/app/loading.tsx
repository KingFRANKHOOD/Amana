import { SkeletonCard } from "@/components/ui/SkeletonCard";

export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-bg-primary px-6 py-12 flex flex-col items-center">
      <div className="max-w-2xl w-full space-y-8">
        {/* Brand block skeleton */}
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-lg bg-bg-elevated animate-pulse" aria-hidden="true" />
          <div className="h-8 w-40 rounded-md bg-bg-elevated animate-pulse" aria-hidden="true" />
          <div className="h-4 w-64 rounded-md bg-bg-elevated animate-pulse" aria-hidden="true" />
        </div>

        {/* Metric cards skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} lines={3} />
          ))}
        </div>
      </div>
    </div>
  );
}
