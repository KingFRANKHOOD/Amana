"use client";

import * as React from "react";
import { clsx } from "clsx";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center gap-4 p-8 text-center",
        className,
      )}
    >
      {icon && (
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-variant text-muted">
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-content">{title}</h2>
        <p className="mx-auto max-w-sm text-sm text-muted">{description}</p>
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
