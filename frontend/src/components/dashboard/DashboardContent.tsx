"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError, TradeResponse, TradeStatsResponse } from "@/lib/api";
import { BentoCard } from "@/components/ui/BentoCard";
import { Activity, CreditCard, CheckCircle2, AlertCircle } from "lucide-react";
import { SkeletonCard } from "@/components/ui/SkeletonCard";
import { SkeletonList } from "@/components/ui/SkeletonList";
import { Skeleton } from "@/components/ui/Skeleton";
import { useTranslation } from "@/hooks/useTranslation";
import { useOffline } from "@/hooks/useOffline";
import { ErrorState } from "@/components/ui/ErrorState";
import { OfflineState } from "@/components/ui/OfflineState";
import { useModal } from "@/hooks/useModal";
import { useDraftForm } from "@/hooks/useDraftForm";
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody, ModalFooter } from "@/components/ui/Modal";
import { z } from "zod";

// Backend TradeStatus enum values (backend/prisma/schema.prisma) are the source of truth.
const STATUS_BADGE_STYLES: Record<string, string> = {
  PENDING_SIGNATURE: "bg-status-warning/10 text-status-warning",
  CREATED: "bg-status-info/10 text-status-info",
  FUNDED: "bg-status-info/10 text-status-info",
  DELIVERED: "bg-status-warning/10 text-status-warning",
  COMPLETED: "bg-status-success/10 text-status-success",
  DISPUTED: "bg-status-danger/10 text-status-danger",
  CANCELLED: "bg-status-danger/10 text-status-danger",
};

export function DashboardContent() {
  const { t } = useTranslation();
  const { token, isAuthenticated } = useAuth();
  const { isOffline, retryOnline } = useOffline();
  
  const [stats, setStats] = useState<TradeStatsResponse | null>(null);
  const [recentTrades, setRecentTrades] = useState<TradeResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Drafts modal and button component (inline)
  function DraftsButton() {
    const modal = useModal();
    const draftsHook = useDraftForm("trade:create", z.any());
    const drafts = draftsHook.list();

    return (
      <div>
        <button onClick={modal.open} className="px-3 py-2 border border-border-default rounded-md text-sm">Drafts ({drafts.length})</button>
        <Modal open={modal.isOpen} onOpenChange={modal.setIsOpen}>
          <ModalContent overlayOpacity="medium">
            <ModalHeader>
              <ModalTitle>Drafts</ModalTitle>
            </ModalHeader>
            <ModalBody>
              {drafts.length === 0 ? (
                <div className="text-sm text-text-secondary">No drafts</div>
              ) : (
                <ul className="space-y-2">
                  {drafts.map((d) => (
                    <li key={d.id} className="flex justify-between items-center">
                      <div className="text-sm text-text-primary">{new Date(d.updatedAt).toLocaleString()}</div>
                      <div className="flex gap-2">
                        <a href="/trades/create" onClick={() => { /* restore is done on create page */ }} className="text-sm text-gold hover:underline">Open</a>
                        <button onClick={() => { draftsHook.clear(d.id); }} className="text-sm px-2 py-1 bg-bg-card border border-border-default rounded">Delete</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </ModalBody>
            <ModalFooter>
              <button onClick={modal.close} className="px-4 py-2 bg-bg-card border border-border-default rounded">Close</button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </div>
    );
  }

  const fetchDashboardData = useCallback(async () => {
      if (!isAuthenticated || !token) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const [statsData, tradesData] = await Promise.all([
          api.trades.getStats(token),
          api.trades.list(token, { limit: 5 }),
        ]);

        setStats(statsData);
        setRecentTrades(tradesData.items);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError(t("dashboard.connectWallet.description"));
        }
      } finally {
        setLoading(false);
      }
  }, [isAuthenticated, token, t]);

  useEffect(() => {
    void fetchDashboardData();
  }, [fetchDashboardData]);

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-bg-elevated border border-border-default flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8 text-gold" />
        </div>
        <h1 className="text-2xl font-bold text-text-primary">{t("dashboard.connectWallet.title")}</h1>
        <p className="text-text-secondary max-w-md">
          {t("dashboard.connectWallet.description")}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="space-y-3">
            <Skeleton className="h-9 w-44" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>

        <div className="rounded-xl border border-border-default bg-bg-card p-5 space-y-4">
          <div className="flex justify-between items-end">
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-4 w-14" />
          </div>
          <SkeletonList rows={4} />
        </div>
      </div>
    );
  }

  if (isOffline) {
    return (
      <OfflineState
        className="min-h-[60vh]"
        onRetry={() => void retryOnline().then(fetchDashboardData)}
      />
    );
  }

  if (error) {
    return (
      <ErrorState
        className="min-h-[60vh]"
        variant="card"
        title="Dashboard unavailable"
        message={error}
        onRetry={() => void fetchDashboardData()}
      />
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-text-primary">{t("dashboard.title")}</h1>
          <p className="text-text-secondary mt-1">{t("dashboard.subtitle")}</p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/trades/create"
            className="px-5 py-2.5 bg-gold text-text-inverse font-semibold rounded-lg hover:bg-gold-hover transition-colors shadow-glow-gold"
          >
            {t("dashboard.createTrade")}
          </Link>
          {/* Drafts */}
          <DraftsButton />
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <BentoCard 
          title={t("dashboard.stats.totalVolume")} 
          icon={<CreditCard className="w-5 h-5" />}
          glowVariant="gold"
        >
          <div className="text-3xl font-bold text-text-primary mt-2">
            {stats?.totalVolume ? `${stats.totalVolume.toLocaleString()} USDC` : "0 USDC"}
          </div>
          <div className="text-sm text-text-secondary mt-1">
            {t("dashboard.stats.totalVolumeDesc")}
          </div>
        </BentoCard>

        <BentoCard 
          title={t("dashboard.stats.activeTrades")} 
          icon={<Activity className="w-5 h-5" />}
          glowVariant="emerald"
        >
          <div className="text-3xl font-bold text-text-primary mt-2">
            {stats?.openTrades || 0}
          </div>
          <div className="text-sm text-status-success mt-1">
            {t("dashboard.stats.activeTradesDesc")}
          </div>
        </BentoCard>

        <BentoCard 
          title={t("dashboard.stats.completedTrades")} 
          icon={<CheckCircle2 className="w-5 h-5" />}
        >
          <div className="text-3xl font-bold text-text-primary mt-2">
            {stats?.completedTrades || 0}
          </div>
          <div className="text-sm text-text-secondary mt-1">
            {t("dashboard.stats.completedTradesDesc")}
          </div>
        </BentoCard>

        <BentoCard 
          title={t("dashboard.stats.disputedTrades")} 
          icon={<AlertCircle className="w-5 h-5" />}
          glowVariant="danger"
        >
          <div className="text-3xl font-bold text-text-primary mt-2">
            {stats?.disputedTrades || 0}
          </div>
          <div className="text-sm text-status-danger mt-1">
            {t("dashboard.stats.disputedTradesDesc")}
          </div>
        </BentoCard>
      </div>

      {/* Recent Trades */}
      <div className="rounded-xl border border-border-default bg-bg-card overflow-hidden">
        <div className="p-5 border-b border-border-default flex justify-between items-center">
          <h2 className="text-lg font-semibold text-text-primary">{t("dashboard.recentTrades")}</h2>
          <Link href="/trades" className="text-sm text-gold hover:underline">
            {t("dashboard.viewAll")}
          </Link>
        </div>
        
        {recentTrades.length === 0 ? (
          <div className="p-8 text-center text-text-secondary">
            {t("dashboard.noTrades")}
          </div>
        ) : (
          <div className="divide-y divide-border-default">
            {recentTrades.map((trade) => (
              <Link
                key={trade.id}
                href={`/trades/${trade.id}`}
                className="flex items-center justify-between p-4 hover:bg-bg-elevated transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-bg-elevated flex items-center justify-center">
                    <CreditCard className="w-5 h-5 text-text-secondary" />
                  </div>
                  <div>
                    <div className="font-medium text-text-primary">
                      {trade.amount} {trade.currency}
                    </div>
                    <div className="text-sm text-text-secondary">
                      {new Date(trade.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-medium ${
                    STATUS_BADGE_STYLES[trade.status] ?? "text-text-muted"
                  }`}
                >
                  {trade.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
