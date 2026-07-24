// Server component — no "use client".
// searchParams are read here so the initial render already reflects the URL
// (?status=active&page=2), making filtered views shareable and
// refresh-stable without a client-side flash.
import { Suspense } from "react";
import { TradesFilters, type TradeStatus } from "./TradesFilters";
import { Skeleton } from "@/components/ui/Skeleton";

interface TradesPageProps {
  searchParams: Promise<{ status?: string; page?: string }>;
}

function parseStatus(raw: string | undefined): TradeStatus {
  const valid: TradeStatus[] = ["active", "pending", "completed", "disputed"];
  return valid.includes(raw as TradeStatus) ? (raw as TradeStatus) : "all";
}

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function TradesPageFallback() {
  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      <div className="flex justify-end mb-6">
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>
      <div className="flex gap-2 mb-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-lg" />
        ))}
      </div>
      <div className="rounded-lg border border-border-default overflow-hidden shadow-elev-1">
        <div className="border-b border-border-default bg-surface-1 px-4 py-3">
          <div className="grid grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-3 w-16" />
            ))}
          </div>
        </div>
        <div className="divide-y divide-border-default bg-surface-0">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="grid grid-cols-5 gap-4 px-4 py-4">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default async function TradesPage({ searchParams }: TradesPageProps) {
  // Next.js 15+ searchParams is a Promise — await it here in the server component.
  const resolved = await searchParams;
  const initialStatus = parseStatus(resolved.status);
  const initialPage   = parsePage(resolved.page);

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      {/*
       * #445 — Shell is canonical: AppTopNav (layout.tsx) includes Trades
       * and highlights the active route, so this page omits a duplicate heading.
       *
       * TradesFilters is wrapped in Suspense because useSearchParams() requires
       * it when used inside a client component in the App Router.
       */}
      <Suspense fallback={<TradesPageFallback />}>
        <TradesFilters
          initialStatus={initialStatus}
          initialPage={initialPage}
        />
      </Suspense>
    </div>
  );
}
