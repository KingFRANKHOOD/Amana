"use client";

import { useMemo, useState } from "react";
import { Check, Clipboard, ExternalLink } from "lucide-react";

export interface WalletAddressBadgeProps {
  address: string;
  truncate?: "start" | "middle" | "end";
  showCopy?: boolean;
  showExplorer?: boolean;
  className?: string;
}

function truncateAddress(
  address: string,
  mode: WalletAddressBadgeProps["truncate"],
): string {
  if (address.length <= 14) {
    return address;
  }

  if (mode === "start") {
    return `...${address.slice(-10)}`;
  }

  if (mode === "end") {
    return `${address.slice(0, 10)}...`;
  }

  // Figma requirement: first 6 + ... + last 4
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function WalletAddressBadge({
  address,
  truncate = "middle",
  showCopy = true,
  showExplorer = false,
  className,
}: WalletAddressBadgeProps) {
  const [copied, setCopied] = useState(false);
  const displayAddress = useMemo(
    () => truncateAddress(address, truncate),
    [address, truncate],
  );

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className={`group bg-elevated border border-border-default rounded-md px-2 py-1 font-mono text-sm inline-flex items-center gap-1.5 ${className ?? ""}`}
    >
      <span className="text-text-secondary">{displayAddress}</span>

      {showCopy && (
        <button
          type="button"
          onClick={() => void onCopy()}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-text-primary"
          aria-label="Copy wallet address"
          title="Copy wallet address"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-emerald" />
          ) : (
            <Clipboard className="w-3.5 h-3.5" />
          )}
        </button>
      )}

      {showExplorer && (
        <a
          href={`https://stellar.expert/explorer/public/account/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-gold"
          aria-label="Open wallet in Stellar Expert"
          title="Open wallet in Stellar Expert"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  );
}
