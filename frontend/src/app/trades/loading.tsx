import { SkeletonList } from "@/components/ui/SkeletonList";

export default function TradesLoading() {
  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      {/* Header skeleton */}
      <div className="flex items-center justify-between mb-6">
        <div className="h-8 w-24 rounded-md bg-bg-elevated animate-pulse" aria-hidden="true" />
        <div className="h-9 w-32 rounded-md bg-bg-elevated animate-pulse" aria-hidden="true" />
      </div>

      {/* Filter tabs skeleton */}
      <div className="flex gap-4 border-b border-border-default pb-3 mb-6">
        {[60, 48, 64, 80, 64].map((w, i) => (
          <div
            key={i}
            className="h-3 rounded bg-bg-elevated animate-pulse"
            style={{ width: w }}
            aria-hidden="true"
          />
        ))}
      </div>

      {/* Table skeleton */}
      <SkeletonList rows={8} columns={5} />
    </div>
  );
}
