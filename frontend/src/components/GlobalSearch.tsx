"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, type SearchResultItem } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

interface GroupedResults {
  trades: SearchResultItem[];
  users: SearchResultItem[];
  contracts: SearchResultItem[];
}

const EMPTY_RESULTS: GroupedResults = { trades: [], users: [], contracts: [] };

const CATEGORY_LABELS: Record<keyof GroupedResults, string> = {
  trades: "Trades",
  users: "Users",
  contracts: "Contracts",
};

const CATEGORY_PATHS: Record<keyof GroupedResults, string> = {
  trades: "/trades",
  users: "/users",
  contracts: "/contracts",
};

interface GlobalSearchProps {
  /** Called when the overlay is dismissed without a selection */
  onClose?: () => void;
}

export function GlobalSearch({ onClose }: GlobalSearchProps) {
  const router = useRouter();
  const { token } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GroupedResults>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allItems = [
    ...results.trades.map((r) => ({ ...r, category: "trades" as const })),
    ...results.users.map((r) => ({ ...r, category: "users" as const })),
    ...results.contracts.map((r) => ({ ...r, category: "contracts" as const })),
  ];

  const open = useCallback(() => {
    setIsOpen(true);
    setQuery("");
    setResults(EMPTY_RESULTS);
    setError(null);
    setActiveIndex(-1);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setResults(EMPTY_RESULTS);
    setActiveIndex(-1);
    onClose?.();
  }, [onClose]);

  // Cmd+K / Ctrl+K global shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (isOpen) {
          close();
        } else {
          open();
        }
      }
      if (e.key === "Escape" && isOpen) {
        close();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, open, close]);

  // Debounced search
  useEffect(() => {
    if (!isOpen) return;

    if (!query.trim()) {
      setResults(EMPTY_RESULTS);
      setError(null);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      if (!token) {
        setError("Please sign in to search");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const data = await api.search.query(token, query.trim());
        setResults(data);
        setActiveIndex(-1);
      } catch {
        setError("Search failed. Please try again.");
        setResults(EMPTY_RESULTS);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, isOpen, token]);

  function handleSelect(item: SearchResultItem & { category: keyof GroupedResults }) {
    router.push(`${CATEGORY_PATHS[item.category]}/${item.id}`);
    close();
  }

  function handleKeyNavigation(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, allItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIndex >= 0 && allItems[activeIndex]) {
      e.preventDefault();
      handleSelect(allItems[activeIndex]);
    }
  }

  const hasResults =
    results.trades.length > 0 ||
    results.users.length > 0 ||
    results.contracts.length > 0;

  if (!isOpen) {
    return (
      <button
        onClick={open}
        aria-label="Open global search"
        className="flex items-center gap-2 rounded-lg border border-border-default bg-bg-elevated px-3 py-1.5 text-sm text-text-muted hover:border-border-hover hover:text-text-secondary transition-colors"
      >
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="6.5" cy="6.5" r="4.5" />
          <path d="M10 10l3 3" strokeLinecap="round" />
        </svg>
        <span>Search</span>
        <kbd className="ml-1 hidden sm:inline-flex items-center gap-0.5 rounded border border-border-default px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
          <span>⌘</span>K
        </kbd>
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Global search"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-overlay backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="w-full max-w-xl rounded-2xl border border-border-default bg-bg-card shadow-modal overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-default">
          <svg className="w-4 h-4 flex-shrink-0 text-text-muted" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="6.5" cy="6.5" r="4.5" />
            <path d="M10 10l3 3" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            role="searchbox"
            aria-label="Search trades, users, and contracts"
            placeholder="Search trades, users, contracts…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyNavigation}
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
          />
          {loading && (
            <svg className="w-4 h-4 animate-spin text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" />
            </svg>
          )}
          <button
            onClick={close}
            aria-label="Close search"
            className="rounded px-1.5 py-0.5 text-xs text-text-muted border border-border-default hover:border-border-hover transition-colors"
          >
            Esc
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto p-2" role="listbox" aria-label="Search results">
          {error && (
            <p className="px-3 py-4 text-center text-sm text-status-danger">{error}</p>
          )}

          {!error && query && !loading && !hasResults && (
            <p className="px-3 py-4 text-center text-sm text-text-muted">No results for &ldquo;{query}&rdquo;</p>
          )}

          {!error && !query && (
            <p className="px-3 py-4 text-center text-sm text-text-muted">Type to search trades, users, and contracts</p>
          )}

          {hasResults &&
            (Object.keys(CATEGORY_LABELS) as Array<keyof GroupedResults>).map((category) => {
              const items = results[category];
              if (items.length === 0) return null;

              const baseOffset =
                category === "trades"
                  ? 0
                  : category === "users"
                    ? results.trades.length
                    : results.trades.length + results.users.length;

              return (
                <div key={category} className="mb-1">
                  <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-muted">
                    {CATEGORY_LABELS[category]}
                  </p>
                  {items.map((item, idx) => {
                    const globalIdx = baseOffset + idx;
                    const isActive = activeIndex === globalIdx;
                    return (
                      <button
                        key={item.id}
                        role="option"
                        aria-selected={isActive}
                        onClick={() => handleSelect({ ...item, category })}
                        className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                          isActive
                            ? "bg-bg-elevated text-text-primary"
                            : "text-text-secondary hover:bg-bg-elevated hover:text-text-primary"
                        }`}
                      >
                        <span className="flex-1 text-sm font-medium truncate">{item.title}</span>
                        {item.subtitle && (
                          <span className="text-xs text-text-muted truncate max-w-[40%]">{item.subtitle}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
