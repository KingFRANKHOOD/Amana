import { SkeletonCard } from "@/components/ui/SkeletonCard";

export default function AssetsLoading() {
  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      {/* Header skeleton */}
      <div className="h-8 w-32 rounded-md bg-bg-elevated animate-pulse mb-6" aria-hidden="true" />

      {/* Asset cards grid skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} lines={4} />
        ))}
      </div>
    </div>
  );
}
