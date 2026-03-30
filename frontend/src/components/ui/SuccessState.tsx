"use client";

import { useState } from "react";
import { Copy, ExternalLink, ArrowRight, Download, Check } from "lucide-react";

// Shield icon with checkmark badge
function ShieldSuccessIcon({ className }: { className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <svg
        viewBox="0 0 48 48"
        fill="none"
        className="w-full h-full"
      >
        <path
          d="M24 4L6 12V24C6 34.5 14 43 24 46C34 43 42 34.5 42 24V12L24 4Z"
          fill="url(#shield-gradient)"
        />
        <defs>
          <linearGradient id="shield-gradient" x1="6" y1="4" x2="42" y2="46" gradientUnits="userSpaceOnUse">
            <stop stopColor="#E0BA6A" />
            <stop offset="1" stopColor="#D4A853" />
          </linearGradient>
        </defs>
      </svg>
      {/* Checkmark badge */}
      <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-emerald rounded-full flex items-center justify-center">
        <Check className="w-4 h-4 text-bg-primary" strokeWidth={3} />
      </div>
    </div>
  );
}

// Sparkle decorations for modal variant
function Sparkles() {
  return (
    <div className="absolute inset-0 pointer-events-none">
      <svg className="absolute -top-2 -left-4 w-4 h-4 text-gold" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0L9.5 6.5L16 8L9.5 9.5L8 16L6.5 9.5L0 8L6.5 6.5L8 0Z" />
      </svg>
      <svg className="absolute -top-1 left-1/2 w-3 h-3 text-gold/60" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0L9 7L16 8L9 9L8 16L7 9L0 8L7 7L8 0Z" />
      </svg>
      <svg className="absolute -top-2 -right-4 w-4 h-4 text-gold" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0L9.5 6.5L16 8L9.5 9.5L8 16L6.5 9.5L0 8L6.5 6.5L8 0Z" />
      </svg>
    </div>
  );
}

// Transaction detail row
interface TransactionDetailProps {
  label: string;
  value: string;
  valueClassName?: string;
  suffix?: string;
}

function TransactionDetail({ label, value, valueClassName, suffix }: TransactionDetailProps) {
  return (
    <div>
      <p className="text-xs text-text-muted uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-base font-semibold ${valueClassName || "text-text-primary"}`}>
        {value}
        {suffix && <span className="text-sm font-normal text-text-secondary ml-1">{suffix}</span>}
      </p>
    </div>
  );
}

// Status badge
interface StatusBadgeProps {
  status: string;
  variant?: "success" | "warning" | "info";
}

function StatusBadge({ status, variant = "success" }: StatusBadgeProps) {
  const variants = {
    success: "text-emerald",
    warning: "text-status-warning",
    info: "text-status-info",
  };

  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${variant === "success" ? "bg-emerald" : variant === "warning" ? "bg-status-warning" : "bg-status-info"}`} />
      <span className={`text-sm font-semibold uppercase tracking-wider ${variants[variant]}`}>
        {status}
      </span>
    </div>
  );
}

// Action button
interface ActionButtonProps {
  label: string;
  onClick?: () => void;
  variant?: "primary" | "outline";
  icon?: "arrow" | "download" | "none";
  className?: string;
}

function ActionButton({ label, onClick, variant = "primary", icon = "none", className }: ActionButtonProps) {
  const baseStyles = "px-6 py-3 rounded-lg font-medium transition-colors duration-200 flex items-center justify-center gap-2";
  const variants = {
    primary: "bg-gold hover:bg-gold-hover text-text-inverse",
    outline: "border border-border-default hover:border-border-hover text-gold bg-transparent",
  };

  return (
    <button
      onClick={onClick}
      className={`${baseStyles} ${variants[variant]} ${className || ""}`}
    >
      {icon === "download" && <Download className="w-4 h-4" />}
      {label}
      {icon === "arrow" && <ArrowRight className="w-4 h-4" />}
    </button>
  );
}

// Transaction hash with copy functionality
interface TransactionHashProps {
  hash: string;
  explorerUrl?: string;
}

function TransactionHash({ hash, explorerUrl }: TransactionHashProps) {
  const [copied, setCopied] = useState(false);

  const truncatedHash = `${hash.slice(0, 6)}...${hash.slice(-4)}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="pt-4 border-t border-border-default">
      <p className="text-xs text-text-muted uppercase tracking-wider mb-2">Transaction Hash</p>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <code className="text-sm font-mono text-text-secondary">{truncatedHash}</code>
          <button
            onClick={handleCopy}
            className="p-1 hover:bg-bg-elevated rounded transition-colors"
            aria-label="Copy transaction hash"
          >
            {copied ? (
              <Check className="w-4 h-4 text-emerald" />
            ) : (
              <Copy className="w-4 h-4 text-text-muted hover:text-text-primary" />
            )}
          </button>
        </div>
        {explorerUrl && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-teal hover:text-emerald flex items-center gap-1 transition-colors"
          >
            View on Explorer
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}

// Main SuccessState component
export interface SuccessStateProps {
  /** Display variant - "page" for full page, "modal" for dialog overlay */
  variant?: "page" | "modal";
  /** Small label above the title */
  statusLabel?: string;
  /** Main heading text */
  title: string;
  /** Description text (for modal variant) - supports JSX for highlighted text */
  description?: React.ReactNode;
  /** Transaction details (for page variant) */
  transactionDetails?: {
    tradeId?: string;
    depositAmount?: string;
    depositCurrency?: string;
    assetDescription?: string;
    vaultStatus?: string;
    transactionHash?: string;
    explorerUrl?: string;
  };
  /** Primary action button */
  primaryAction?: {
    label: string;
    onClick?: () => void;
    icon?: "arrow" | "download" | "none";
  };
  /** Secondary action button */
  secondaryAction?: {
    label: string;
    onClick?: () => void;
    icon?: "arrow" | "download" | "none";
  };
  /** Show decorative sparkles (modal variant) */
  showSparkles?: boolean;
  /** Additional className */
  className?: string;
  /** Callback when modal backdrop is clicked */
  onBackdropClick?: () => void;
}

export function SuccessState({
  variant = "page",
  statusLabel,
  title,
  description,
  transactionDetails,
  primaryAction,
  secondaryAction,
  showSparkles = false,
  className,
  onBackdropClick,
}: SuccessStateProps) {
  if (variant === "modal") {
    return (
      <div
        className="fixed inset-0 bg-bg-overlay flex items-center justify-center z-50"
        onClick={onBackdropClick}
      >
        <div
          className={`bg-bg-card border border-border-default rounded-2xl p-8 max-w-md w-full mx-4 shadow-modal relative ${className || ""}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Icon with optional sparkles */}
          <div className="flex justify-center mb-6">
            <div className="relative">
              {showSparkles && <Sparkles />}
              <div className="w-20 h-20 bg-gold/10 rounded-xl flex items-center justify-center">
                <ShieldSuccessIcon className="w-12 h-12" />
              </div>
            </div>
          </div>

          {/* Title */}
          <h2 className="text-2xl font-bold text-text-primary text-center mb-3 text-balance">
            {title}
          </h2>

          {/* Description */}
          {description && (
            <p className="text-text-secondary text-center mb-8 leading-relaxed">
              {description}
            </p>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-3">
            {primaryAction && (
              <ActionButton
                label={primaryAction.label}
                onClick={primaryAction.onClick}
                variant="primary"
                icon={primaryAction.icon}
                className="w-full"
              />
            )}
            {secondaryAction && (
              <ActionButton
                label={secondaryAction.label}
                onClick={secondaryAction.onClick}
                variant="outline"
                icon={secondaryAction.icon}
                className="w-full"
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  // Page variant
  return (
    <div className={`flex flex-col items-center ${className || ""}`}>
      {/* Icon with glow effect */}
      <div className="relative mb-8">
        <div className="absolute inset-0 bg-gold/20 blur-2xl rounded-full" />
        <ShieldSuccessIcon className="w-20 h-20 relative" />
      </div>

      {/* Status label */}
      {statusLabel && (
        <p className="text-sm text-text-muted uppercase tracking-widest mb-3">
          {statusLabel}
        </p>
      )}

      {/* Title */}
      <h1 className="text-3xl md:text-4xl font-bold text-text-primary text-center mb-10 text-balance">
        {title}
      </h1>

      {/* Transaction details card */}
      {transactionDetails && (
        <div className="w-full max-w-2xl bg-bg-card border border-border-default rounded-2xl p-6 mb-8 relative overflow-hidden">
          {/* Watermark logo */}
          <div className="absolute bottom-4 right-4 w-24 h-24 opacity-10">
            <svg viewBox="0 0 100 100" fill="currentColor" className="text-text-muted">
              <circle cx="50" cy="50" r="45" stroke="currentColor" strokeWidth="2" fill="none" />
              <path d="M50 20L30 45H45V80H55V45H70L50 20Z" />
            </svg>
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-6 mb-6">
            {transactionDetails.tradeId && (
              <TransactionDetail label="Trade ID" value={transactionDetails.tradeId} />
            )}
            {transactionDetails.depositAmount && (
              <TransactionDetail
                label="Deposit Amount"
                value={transactionDetails.depositAmount}
                valueClassName="text-gold text-2xl"
                suffix={transactionDetails.depositCurrency}
              />
            )}
            {transactionDetails.assetDescription && (
              <TransactionDetail label="Asset Description" value={transactionDetails.assetDescription} />
            )}
            {transactionDetails.vaultStatus && (
              <div>
                <p className="text-xs text-text-muted uppercase tracking-wider mb-1">Vault Status</p>
                <StatusBadge status={transactionDetails.vaultStatus} variant="success" />
              </div>
            )}
          </div>

          {/* Transaction hash */}
          {transactionDetails.transactionHash && (
            <TransactionHash
              hash={transactionDetails.transactionHash}
              explorerUrl={transactionDetails.explorerUrl}
            />
          )}
        </div>
      )}

      {/* Actions */}
      {(primaryAction || secondaryAction) && (
        <div className="flex flex-col sm:flex-row gap-4">
          {primaryAction && (
            <ActionButton
              label={primaryAction.label}
              onClick={primaryAction.onClick}
              variant="primary"
              icon={primaryAction.icon}
            />
          )}
          {secondaryAction && (
            <ActionButton
              label={secondaryAction.label}
              onClick={secondaryAction.onClick}
              variant="outline"
              icon={secondaryAction.icon}
            />
          )}
        </div>
      )}
    </div>
  );
}
