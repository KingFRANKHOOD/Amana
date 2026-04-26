"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError, TradeResponse, TradeStatsResponse } from "@/lib/api";
import { BentoCard } from "@/components/ui/BentoCard";
import { Activity, CreditCard, CheckCircle2, AlertCircle } from "lucide-react";
import { LoadingState } from "@/components/ui/LoadingState";

export default function DashboardPage() {
  const { token, isAuthenticated } = useAuth();
  
  const [stats, setStats] = useState<TradeStatsResponse | null>(null);
  const [recentTrades, setRecentTrades] = useState<TradeResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDashboardData() {
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
          setError("Failed to load dashboard data");
        }
      } finally {
        setLoading(false);
      }
    }

    fetchDashboardData();
  }, [isAuthenticated, token]);

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-bg-elevated border border-border-default flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8 text-gold" />
        </div>
        <h1 className="text-2xl font-bold text-text-primary">Connect Wallet</h1>
        <p className="text-text-secondary max-w-md">
          Please connect your wallet to access your personalized Amana dashboard, track your trades, and manage your assets.
        </p>
      </div>
    );
  }

  if (loading) {
    return <LoadingState message="Loading your dashboard..." />;
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-status-danger/10 border border-status-danger/40 rounded-lg p-4 text-center">
          <p className="text-status-danger">{error}</p>
          <button 
            onClick={() => window.location.reload()} 
            className="mt-4 px-4 py-2 text-sm font-medium bg-bg-elevated hover:bg-bg-card rounded-md border border-border-default transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-text-primary">Dashboard</h1>
          <p className="text-text-secondary mt-1">Overview of your agricultural trade activities.</p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/trades/create"
            className="px-5 py-2.5 bg-gold text-text-inverse font-semibold rounded-lg hover:bg-gold-hover transition-colors shadow-glow-gold"
          >
            Create Trade
          </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <BentoCard 
          title="Total Volume" 
          icon={<CreditCard className="w-5 h-5" />}
          glowVariant="gold"
        >
          <div className="text-3xl font-bold text-text-primary mt-2">
            {stats?.totalVolume ? `${stats.totalVolume.toLocaleString()} USDC` : "0 USDC"}
          </div>
          <div className="text-sm text-text-secondary mt-1">
            Total historical trade volume
          </div>
        </BentoCard>

        <BentoCard 
          title="Active Trades" 
          icon={<Activity className="w-5 h-5" />}
          glowVariant="emerald"
        >
          <div className="text-3xl font-bold text-text-primary mt-2">
            {stats?.openTrades || 0}
          </div>
          <div className="text-sm text-status-success mt-1">
            Currently in progress
          </div>
        </BentoCard>

        <BentoCard 
          title="Completed Trades" 
          icon={<CheckCircle2 className="w-5 h-5" />}
        >
          <div className="text-3xl font-bold text-text-primary mt-2">
            {(stats?.totalTrades || 0) - (stats?.openTrades || 0)}
          </div>
          <div className="text-sm text-text-secondary mt-1">
            Successfully settled
          </div>
        </BentoCard>

        <BentoCard 
          title="Total Trades" 
          icon={<AlertCircle className="w-5 h-5" />}
        >
          <div className="text-3xl font-bold text-text-primary mt-2">
            {stats?.totalTrades || 0}
          </div>
          <div className="text-sm text-text-secondary mt-1">
            Lifetime trades created
          </div>
        </BentoCard>
      </div>

      {/* Recent Activity Section */}
      <div className="space-y-4">
        <div className="flex justify-between items-end">
          <h2 className="text-xl font-semibold text-text-primary">Recent Trades</h2>
          <Link href="/trades" className="text-sm text-gold hover:underline underline-offset-4">
            View All
          </Link>
        </div>
        
        {recentTrades.length === 0 ? (
          <div className="bg-bg-card border border-border-default rounded-xl p-8 text-center flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-bg-elevated border border-border-default flex items-center justify-center mb-3">
              <Activity className="w-6 h-6 text-text-muted" />
            </div>
            <p className="text-text-primary font-medium">No recent trades found.</p>
            <p className="text-text-secondary text-sm mt-1 max-w-sm mb-4">
              You haven't initiated or received any trades yet. Create your first trade to get started.
            </p>
            <Link
              href="/trades/create"
              className="px-4 py-2 bg-bg-elevated border border-border-default text-text-primary text-sm font-medium rounded-lg hover:bg-bg-input transition-colors"
            >
              Start Trading
            </Link>
          </div>
        ) : (
          <div className="bg-bg-card border border-border-default rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-text-muted uppercase bg-bg-elevated/50 border-b border-border-default">
                  <tr>
                    <th scope="col" className="px-6 py-4 font-medium">Trade ID</th>
                    <th scope="col" className="px-6 py-4 font-medium">Counterparty</th>
                    <th scope="col" className="px-6 py-4 font-medium">Amount</th>
                    <th scope="col" className="px-6 py-4 font-medium">Status</th>
                    <th scope="col" className="px-6 py-4 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTrades.map((trade, idx) => (
                    <tr 
                      key={trade.tradeId} 
                      className={`
                        border-b border-border-default hover:bg-bg-elevated/40 transition-colors
                        ${idx === recentTrades.length - 1 ? 'border-b-0' : ''}
                      `}
                    >
                      <td className="px-6 py-4 font-mono text-gold">
                        <Link href={`/trades/${trade.tradeId}`} className="hover:underline">
                          {trade.tradeId.substring(0, 8)}...
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-text-secondary font-mono">
                        {trade.sellerAddress.substring(0, 6)}...{trade.sellerAddress.substring(trade.sellerAddress.length - 4)}
                      </td>
                      <td className="px-6 py-4 text-text-primary font-medium">
                        {trade.amountUsdc} USDC
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 text-xs font-medium rounded-full capitalize
                          ${trade.status === 'active' ? 'bg-status-success/20 text-status-success border border-status-success/30' : 
                            trade.status === 'completed' ? 'bg-bg-elevated text-text-secondary border border-border-default' :
                            trade.status === 'pending' ? 'bg-status-warning/20 text-status-warning border border-status-warning/30' :
                            'bg-status-danger/20 text-status-danger border border-status-danger/30'
                          }
                        `}>
                          {trade.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-text-secondary">
                        {new Date(trade.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
