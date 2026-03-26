"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="1" y="1" width="6" height="6" rx="1" />
        <rect x="9" y="1" width="6" height="6" rx="1" />
        <rect x="1" y="9" width="6" height="6" rx="1" />
        <rect x="9" y="9" width="6" height="6" rx="1" />
      </svg>
    ),
  },
  {
    href: "/vault",
    label: "Vault",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="1" y="3" width="14" height="11" rx="1.5" />
        <circle cx="8" cy="8.5" r="2" />
        <path d="M8 3V1" />
      </svg>
    ),
  },
  {
    href: "/assets",
    label: "Assets",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M1 4l7-3 7 3v4c0 3.5-3 6-7 7-4-1-7-3.5-7-7V4z" />
      </svg>
    ),
  },
  {
    href: "/profile",
    label: "Profile",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="8" cy="5" r="3" />
        <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      </svg>
    ),
  },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 flex-shrink-0 bg-card border-r border-border-default flex flex-col min-h-screen">
      {/* Vault branding block */}
      <div className="px-5 py-5 border-b border-border-default">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gold-muted border border-gold/30 flex items-center justify-center">
            <svg className="w-4 h-4 text-gold" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M1 4l7-3 7 3v4c0 3.5-3 6-7 7-4-1-7-3.5-7-7V4z" />
            </svg>
          </div>
          <div>
            <p className="text-text-primary text-sm font-bold">Amana Vault</p>
            <p className="text-text-muted text-xs tracking-wide">SECURE AGRICULTURAL ESCROW</p>
          </div>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? "bg-gold-muted text-gold border border-gold/20"
                  : "text-text-secondary hover:text-text-primary hover:bg-elevated"
              }`}
            >
              <span className={isActive ? "text-gold" : "text-text-muted"}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Lock asset CTA */}
      <div className="px-4 pb-6">
        <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-gold/30 bg-gold-muted text-gold text-sm font-semibold hover:bg-gold/20 transition-all">
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="8" cy="8" r="7" />
            <path d="M8 5v6M5 8h6" />
          </svg>
          Lock New Asset
        </button>
      </div>
    </aside>
  );
}
