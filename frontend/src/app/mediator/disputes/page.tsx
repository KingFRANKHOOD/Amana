"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useFreighterIdentity } from "@/hooks/useFreighterIdentity";
import { api, ApiError, DisputeResponse } from "@/lib/api";

type DisputeStatus = "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "CLOSED";

const FILTERS: { label: string; value: DisputeStatus | "all" }[] = [
  { label: "All Active", value: "all" },
  { label: "Open", value: "OPEN" },
  { label: "Under Review", value: "UNDER_REVIEW" },
  { label: "Resolved", value: "RESOLVED" },
  { label: "Closed", value: "CLOSED" },
];

const STATUS_STYLES: Record<string, string> = {
  OPEN: "text-status-warning bg-status-warning/15",
  UNDER_REVIEW: "text-status-info bg-status-info/15",
  RESOLVED: "text-status-success bg-status-success/15",
  CLOSED: "text-text-secondary bg-bg-elevated",
};

const DEFAULT_MEDIATOR_ADDRESSES = ["GEXAMPLEMEDIATORPUBLICKEY1"];

const PAGE_SIZE = 10;

export default function MediatorDisputesPage() {
  const { token, isAuthenticated } = useAuth();
  const { address } = useFreighterIdentity();
  const [activeFilter, setActiveFilter] = useState<DisputeStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [disputes, setDisputes] = useState<DisputeResponse[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mediatorAddresses = useMemo(() => {
    const fromEnv = (process.env.NEXT_PUBLIC_MEDIATOR_WALLETS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

    return fromEnv.length > 0 ? fromEnv : DEFAULT_MEDIATOR_ADDRESSES;
  }, []);

  const isMediator = Boolean(address && mediatorAddresses.includes(address));

  useEffect(() => {
    async function fetchDisputes() {
      if (!isAuthenticated || !token || !isMediator) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const statusParam = activeFilter === "all" ? undefined : activeFilter;
        const response = await api.disputes.list(token, {
          status: statusParam,
          page,
          limit: PAGE_SIZE,
        });

        setDisputes(response.items);
        setTotalPages(response.pagination.totalPages);
      } catch (err) {
        let errorMessage = "Failed to load disputes";
        if (err instanceof ApiError) {
          errorMessage = err.message;
        } else if (err instanceof Error) {
          errorMessage = err.message;
        }
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    }

    fetchDisputes();
  }, [token, isAuthenticated, isMediator, activeFilter, page]);

  function handleFilter(value: DisputeStatus | "all") {
    setActiveFilter(value);
    setPage(1);
  }

  function formatDate(dateString: string) {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function formatAddress(address: string) {
    if (address.length <= 12) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  if (!isMediator) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-text-primary mb-4">Access Restricted</h1>
          <p className="text-text-secondary">
            This page is only accessible to authorized mediators.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto">
        <div className="text-center">Loading disputes...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto">
        <div className="text-center text-status-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-text-primary">Mediator Disputes</h1>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6">
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            onClick={() => handleFilter(filter.value)}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
              activeFilter === filter.value
                ? "bg-gold text-text-inverse"
                : "bg-bg-elevated text-text-secondary hover:bg-bg-hover"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Disputes list */}
      <div className="space-y-4">
        {disputes.length === 0 ? (
          <div className="text-center py-12 text-text-secondary">
            No disputes found
          </div>
        ) : (
          disputes.map((dispute) => (
            <Link
              key={dispute.id}
              href={`/mediator/disputes/${dispute.tradeId}`}
              className="block p-6 bg-bg-elevated rounded-lg border border-border-default hover:border-border-hover transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-lg font-semibold text-text-primary">
                      Trade {dispute.tradeId}
                    </span>
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[dispute.status]}`}
                    >
                      {dispute.status.replace("_", " ")}
                    </span>
                  </div>
                  <div className="text-sm text-text-secondary mb-2">
                    Initiated by: {formatAddress(dispute.initiator)}
                  </div>
                  <div className="text-sm text-text-secondary mb-2">
                    Buyer: {formatAddress(dispute.trade.buyerAddress)} | Seller: {formatAddress(dispute.trade.sellerAddress)}
                  </div>
                  <div className="text-sm text-text-secondary">
                    Amount: ${dispute.trade.amountUsdc} USDC
                  </div>
                  <div className="text-sm text-text-secondary mt-1">
                    Created: {formatDate(dispute.createdAt)}
                  </div>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-8">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-3 py-1 rounded-md bg-bg-elevated text-text-secondary disabled:opacity-50 disabled:cursor-not-allowed hover:bg-bg-hover transition-colors"
          >
            Previous
          </button>
          <span className="px-3 py-1 text-text-secondary">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="px-3 py-1 rounded-md bg-bg-elevated text-text-secondary disabled:opacity-50 disabled:cursor-not-allowed hover:bg-bg-hover transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}