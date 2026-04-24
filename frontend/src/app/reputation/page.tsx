"use client";

import React from "react";

interface MetricCardProps {
  title: string;
  value: string;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
}

function MetricCard({ title, value, change, changeType }: MetricCardProps) {
  return (
    <div className="bg-bg-elevated rounded-lg p-6 border border-border-default">
      <h3 className="text-sm font-medium text-text-secondary mb-2">{title}</h3>
      <div className="text-2xl font-bold text-text-primary mb-1">{value}</div>
      {change && (
        <div
          className={`text-sm ${
            changeType === "positive"
              ? "text-status-success"
              : changeType === "negative"
              ? "text-status-danger"
              : "text-text-secondary"
          }`}
        >
          {change}
        </div>
      )}
    </div>
  );
}

interface HistoryItemProps {
  date: string;
  event: string;
  impact: string;
}

function HistoryItem({ date, event, impact }: HistoryItemProps) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border-default last:border-b-0">
      <div>
        <div className="text-sm font-medium text-text-primary">{event}</div>
        <div className="text-xs text-text-secondary">{date}</div>
      </div>
      <div className="text-sm text-text-primary">{impact}</div>
    </div>
  );
}

export default function ReputationPage() {
  // Mock data - in real implementation, this would come from API
  const metrics = [
    {
      title: "Trust Score",
      value: "98.5%",
      change: "+2.1%",
      changeType: "positive" as const,
    },
    {
      title: "Total Trades",
      value: "247",
      change: "+12",
      changeType: "positive" as const,
    },
    {
      title: "Success Rate",
      value: "96.8%",
      change: "+0.5%",
      changeType: "positive" as const,
    },
    {
      title: "Avg. Rating",
      value: "4.9/5",
      change: "No change",
      changeType: "neutral" as const,
    },
  ];

  const history = [
    {
      date: "Dec 15, 2024",
      event: "Completed trade with high rating",
      impact: "+0.2%",
    },
    {
      date: "Dec 10, 2024",
      event: "Successful dispute resolution",
      impact: "+0.1%",
    },
    {
      date: "Dec 5, 2024",
      event: "New buyer verification",
      impact: "+0.3%",
    },
    {
      date: "Nov 28, 2024",
      event: "Trade milestone reached",
      impact: "+0.1%",
    },
  ];

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text-primary mb-2">Reputation</h1>
        <p className="text-text-secondary">
          Your trading reputation and trust metrics on the Amana platform
        </p>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {metrics.map((metric, index) => (
          <MetricCard key={index} {...metric} />
        ))}
      </div>

      {/* Trust History */}
      <div className="bg-bg-elevated rounded-lg border border-border-default">
        <div className="p-6 border-b border-border-default">
          <h2 className="text-xl font-semibold text-text-primary">Trust History</h2>
          <p className="text-sm text-text-secondary mt-1">
            Recent events that impacted your reputation score
          </p>
        </div>
        <div className="p-6">
          <div className="space-y-0">
            {history.map((item, index) => (
              <HistoryItem key={index} {...item} />
            ))}
          </div>
        </div>
      </div>

      {/* Additional sections can be added here based on Figma design */}
    </div>
  );
}