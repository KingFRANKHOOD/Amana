"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError, type ReputationResponse } from "@/lib/api";
import { RepScoreRing } from "@/components/ui/RepScoreRing";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { AlertCircle, RefreshCw, TrendingUp, CheckCircle2, AlertTriangle, Clock } from "lucide-react";

function SkeletonReputationPage() {
  return (
    <div className="px-6 py-8 max-w-6xl mx-auto space-y-8">
      <div className="space-y-3">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-bg-elevated rounded-lg border border-border-default p-8 flex flex-col items-center gap-4">
          <Skeleton className="h-32 w-32 rounded-full" />
          <Skeleton className="h-5 w-16" />
        </div>

        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-bg-elevated rounded-lg border border-border-default p-6 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-16" />
            </div>
          ))}
        </div>
      </div>

      <div className="bg-bg-elevated rounded-lg border border-border-default">
        <div className="p-6 border-b border-border-default space-y-2">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="p-6 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="space-y-1">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function getImpactColor(impact: number): string {
  if (impact > 0) return "text-status-success";
  if (impact < 0) return "text-status-danger";
  return "text-text-secondary";
}

function getImpactLabel(impact: number): string {
  if (impact > 0) return `+${impact}`;
  return `${impact}`;
}

function getEventIcon(type: string) {
  switch (type) {
    case "trade_completed":
      return <CheckCircle2 className="w-4 h-4 text-status-success" />;
    case "trade_initiated":
      return <Clock className="w-4 h-4 text-status-info" />;
    case "dispute_initiated":
      return <AlertTriangle className="w-4 h-4 text-status-warning" />;
    case "dispute_resolved":
      return <AlertCircle className="w-4 h-4 text-status-danger" />;
    default:
      return <TrendingUp className="w-4 h-4 text-text-secondary" />;
  }
}

export default function ReputationPage() {
  const { token, isAuthenticated, isLoading: authLoading } = useAuth();

  const [data, setData] = useState<ReputationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReputation = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const reputation = await api.reputation.getMyReputation(token);
      setData(reputation);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to load reputation data");
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (isAuthenticated && token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchReputation();
    }
  }, [isAuthenticated, token, fetchReputation]);

  const isPageLoading = authLoading || (isAuthenticated && loading);

  if (!isAuthenticated && !authLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-bg-elevated border border-border-default flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-gold" />
        </div>
        <h1 className="text-2xl font-bold text-text-primary">Connect Wallet</h1>
        <p className="text-text-secondary max-w-md">
          Please connect your wallet to view your trust score and trading reputation on the Amana platform.
        </p>
      </div>
    );
  }

  if (isPageLoading) {
    return <SkeletonReputationPage />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-bg-elevated border border-border-default flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-status-danger" />
        </div>
        <h1 className="text-xl font-semibold text-text-primary">Failed to Load Reputation</h1>
        <p className="text-text-secondary max-w-md">{error}</p>
        <Button variant="primary" onClick={fetchReputation}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Try Again
        </Button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-bg-elevated border border-border-default flex items-center justify-center">
          <TrendingUp className="w-8 h-8 text-text-secondary" />
        </div>
        <h1 className="text-2xl font-bold text-text-primary">No Reputation Data</h1>
        <p className="text-text-secondary max-w-md">
          Your reputation will be calculated once you start trading on the Amana platform.
        </p>
      </div>
    );
  }

  const ringScore = (data.trustScore / 100) * 5;

  const metrics = [
    {
      title: "Total Trades",
      value: data.totalTrades.toString(),
      icon: <TrendingUp className="w-5 h-5 text-gold" />,
    },
    {
      title: "Completed",
      value: data.completedTrades.toString(),
      icon: <CheckCircle2 className="w-5 h-5 text-status-success" />,
    },
    {
      title: "Disputed",
      value: data.disputedTrades.toString(),
      icon: <AlertTriangle className="w-5 h-5 text-status-warning" />,
    },
    {
      title: "Success Rate",
      value: `${data.successRate}%`,
      icon: <TrendingUp className="w-5 h-5 text-status-info" />,
    },
  ];

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text-primary mb-2">Reputation</h1>
        <p className="text-text-secondary">
          Your trading reputation and trust metrics on the Amana platform
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="bg-bg-elevated rounded-lg border border-border-default p-8 flex flex-col items-center gap-3">
          <RepScoreRing score={ringScore} size="xl" animated />
          <p className="text-sm text-text-secondary mt-2">Trust Score</p>
          <p className="text-3xl font-bold text-text-primary">{data.trustScore}</p>
          <p className="text-xs text-text-muted">out of 100</p>
        </div>

        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {metrics.map((metric) => (
            <div
              key={metric.title}
              className="bg-bg-elevated rounded-lg border border-border-default p-6"
            >
              <div className="flex items-center gap-2 mb-3">
                {metric.icon}
                <h3 className="text-sm font-medium text-text-secondary">{metric.title}</h3>
              </div>
              <p className="text-2xl font-bold text-text-primary">{metric.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-bg-elevated rounded-lg border border-border-default">
        <div className="p-6 border-b border-border-default">
          <h2 className="text-xl font-semibold text-text-primary">Trust History</h2>
          <p className="text-sm text-text-secondary mt-1">
            Recent events that impacted your reputation score
          </p>
        </div>
        <div className="p-6">
          {data.history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
              <Clock className="w-12 h-12 text-text-muted" />
              <p className="text-text-secondary">
                No reputation events yet. Complete trades to build your trust history.
              </p>
            </div>
          ) : (
            <div className="space-y-0">
              {data.history.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between py-3 border-b border-border-default last:border-b-0"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0">
                      {getEventIcon(item.type)}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-text-primary">{item.event}</div>
                      <div className="text-xs text-text-secondary">{formatDate(item.timestamp)}</div>
                    </div>
                  </div>
                  <span className={`text-sm font-medium ${getImpactColor(item.impact)}`}>
                    {getImpactLabel(item.impact)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
