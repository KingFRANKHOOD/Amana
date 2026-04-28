"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

export interface SideNavBarProps {
  activePath: string;
  isConnected: boolean;
  onConnectWallet: () => void;
  collapsed?: boolean;
  walletAddress?: string | null;
  onClose?: () => void;
}

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg
        className="w-4 h-4"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <rect x="1" y="1" width="6" height="6" rx="1" />
        <rect x="9" y="1" width="6" height="6" rx="1" />
        <rect x="1" y="9" width="6" height="6" rx="1" />
        <rect x="9" y="9" width="6" height="6" rx="1" />
      </svg>
    ),
  },
  {
    href: "/trades",
    label: "Trades",
    icon: (
      <svg
        className="w-4 h-4"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M2 4h12M2 8h9M2 12h6" />
        <path d="M10 8l2 2 3-3" />
      </svg>
    ),
  },
  {
    href: "/vault",
    label: "Vault",
    icon: (
      <svg
        className="w-4 h-4"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <rect x="1" y="3" width="14" height="11" rx="1.5" />
        <circle cx="8" cy="8.5" r="2" />
        <path d="M8 3V1" />
      </svg>
    ),
  },
  {
    href: "/reputation",
    label: "Reputation",
    icon: (
      <svg
        className="w-4 h-4"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M8 1l2.1 4.3 4.7.7-3.4 3.3.8 4.7L8 11.7 3.8 14l.8-4.7L1.2 6l4.7-.7L8 1z" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg
        className="w-4 h-4"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <circle cx="8" cy="8" r="2.2" />
        <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M12.9 3.1l-1.4 1.4M4.5 11.5l-1.4 1.4" />
      </svg>
    ),
  },
];

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

export function SideNavBar({
  activePath,
  isConnected,
  onConnectWallet,
  collapsed = false,
  walletAddress,
  onClose,
}: SideNavBarProps) {
  return (
    <aside
      className={`${
        collapsed ? "w-20" : "w-64"
      } flex-shrink-0 bg-surface-1 border-r border-border-default shadow-elev-1 flex flex-col min-h-screen`}
      aria-label="Primary sidebar"
    >
      <div className="h-16 px-4 border-b border-border-default flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg bg-gold-muted border border-gold/30 flex items-center justify-center text-gold">
            <svg
              className="w-4 h-4"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M1 4l7-3 7 3v4c0 3.5-3 6-7 7-4-1-7-3.5-7-7V4z" />
            </svg>
          </span>
          {!collapsed && (
            <span className="text-text-primary text-lg font-semibold">Amana</span>
          )}
        </Link>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="lg:hidden w-8 h-8 rounded-lg flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-all"
            aria-label="Close menu"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>

      <nav
        className="flex-1 py-4"
        role="navigation"
        aria-label="Main navigation"
      >
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive =
              activePath === item.href || activePath.startsWith(`${item.href}/`);

            return (
              <li key={item.href} role="none">
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center ${
                    collapsed ? "justify-center px-2" : "px-4"
                  } py-3 border-l-4 transition-all focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2 ${
                    isActive
                      // Active: surface-2 lift + gold left border + elev-2 shadow
                      ? "border-l-gold bg-surface-2 text-gold shadow-elev-2 hover:bg-surface-2/80"
                      // Inactive: hover lifts to surface-2/30
                      : "border-transparent text-text-secondary hover:text-text-primary hover:bg-surface-2/30"
                  }`}
                  title={collapsed ? item.label : undefined}
                >
                  <span className="w-5 h-5 flex items-center justify-center">
                    {item.icon}
                  </span>
                  {!collapsed && <span className="ml-3 text-sm">{item.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="p-4 border-t border-border-default">
        {isConnected ? (
          <div
            className={`rounded-lg bg-surface-2 border border-border-raised ${
              collapsed ? "px-2 py-3 text-center" : "px-3 py-3"
            }`}
          >
            <p className="text-[11px] uppercase tracking-widest text-text-muted">
              Wallet
            </p>
            <p className="text-sm text-text-primary mt-1">
              {walletAddress ? truncateAddress(walletAddress) : "Connected"}
            </p>
          </div>
        ) : (
          <Button
            type="button"
            onClick={onConnectWallet}
            variant="primary"
            className={collapsed ? "px-2 py-2.5" : "px-3 py-2.5"}
          >
            {collapsed ? "Link" : "Connect Wallet"}
          </Button>
        )}
      </div>
    </aside>
  );
}
