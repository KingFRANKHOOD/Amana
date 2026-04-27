"use client";

import React from "react";

export interface TabItem<T = string> {
  value: T;
  label: string;
}

export interface TabsProps<T = string> {
  items: TabItem<T>[];
  activeValue: T;
  onChange: (value: T) => void;
  variant?: "underline" | "bordered";
  className?: string;
}

export function Tabs<T = string>({
  items,
  activeValue,
  onChange,
  variant = "underline",
  className = "",
}: TabsProps<T>) {
  return (
    <div className={`flex gap-2 ${variant === "underline" ? "border-b border-border-default pb-px" : ""} ${className}`}>
      {items.map((item) => {
        const isActive = activeValue === item.value;

        if (variant === "underline") {
          return (
            <button
              key={item.value}
              onClick={() => onChange(item.value)}
              aria-selected={isActive}
              role="tab"
              className={`pb-3 px-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2 ${
                isActive
                  ? "text-gold underline underline-offset-8 decoration-gold decoration-2"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {item.label}
            </button>
          );
        }

        // Bordered variant (for assets page style)
        return (
          <button
            key={item.value}
            onClick={() => onChange(item.value)}
            aria-selected={isActive}
            role="tab"
            className={`text-xs font-semibold uppercase tracking-widest pb-px transition-colors focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2 ${
              isActive
                ? "text-gold border-b-2 border-gold"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
