"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface AppTopNavProps {
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
}

// #445 — include Trades so the canonical shell highlights the active route;
// this eliminates the need for a redundant page-level title that duplicated
// the navigation context.
const TOP_NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/trades", label: "Trades" },
  { href: "/assets", label: "Assets" },
  { href: "/vault", label: "Vault" },
];

const NAV_ITEM_BASE =
  "rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2";
const NAV_ITEM_ACTIVE = "bg-surface-2 text-gold shadow-elev-1";
const NAV_ITEM_INACTIVE = "text-text-secondary hover:text-text-primary hover:bg-surface-2/60";

export function AppTopNav({
  onToggleSidebar,
  isSidebarOpen,
}: AppTopNavProps) {
  const pathname = usePathname();

  return (
    <header className="h-14 bg-card border-b border-border-default flex items-center px-4 lg:px-6 gap-4 lg:gap-8 flex-shrink-0">
      {/* Mobile menu button */}
      <button
        type="button"
        onClick={onToggleSidebar}
        className="lg:hidden w-8 h-8 rounded-lg flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-elevated transition-all"
        aria-label={isSidebarOpen ? "Close menu" : "Open menu"}
      >
        <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
          {isSidebarOpen ? (
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          ) : (
            <path
              fillRule="evenodd"
              d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
              clipRule="evenodd"
            />
          )}
        </svg>
      </button>

      {/* Logo */}
      <Link href="/" className="text-gold font-bold text-lg tracking-tight flex-shrink-0">
        Amana
      </Link>

      {/* Nav links */}
      <nav className="flex items-center gap-1">
        {TOP_NAV.map((item) => {
          const isActive = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${NAV_ITEM_BASE} ${isActive ? NAV_ITEM_ACTIVE : NAV_ITEM_INACTIVE}`}
              aria-current={isActive ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Right side */}
      <div className="ml-auto flex items-center gap-3">
        {/* Notification bell */}
        <button className="w-8 h-8 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-elevated transition-all">
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M8 1a5 5 0 015 5v3l1.5 2.5H1.5L3 9V6a5 5 0 015-5z" />
            <path d="M6.5 13.5a1.5 1.5 0 003 0" />
          </svg>
        </button>

        {/* Avatar */}
        <button className="w-8 h-8 rounded-full bg-elevated border border-border-default flex items-center justify-center text-text-secondary hover:text-text-primary transition-all">
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="8" cy="5" r="3" />
            <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
          </svg>
        </button>
      </div>
    </header>
  );
}
