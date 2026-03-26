"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TOP_NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/assets", label: "Assets" },
  { href: "/vault", label: "Vault" },
];

export function AppTopNav() {
  const pathname = usePathname();

  return (
    <header className="h-14 bg-card border-b border-border-default flex items-center px-6 gap-8 flex-shrink-0">
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
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "text-text-primary bg-elevated"
                  : "text-text-secondary hover:text-text-primary"
              }`}
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
