"use client";

interface DividerProps {
  orientation?: "horizontal" | "vertical";
  label?: string;
  className?: string;
}

export default function Divider({
  orientation = "horizontal",
  label,
  className = "",
}: DividerProps) {
  if (orientation === "vertical") {
    return (
      <div className={`relative flex items-center justify-center w-px h-full bg-border-default ${className}`}>
        {label && (
          <span className="absolute bg-bg-primary px-2 text-xs text-text-muted">
            {label}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`relative flex items-center w-full ${className}`}>
      <div className="h-px w-full bg-border-default" />
      {label && (
        <span className="absolute left-1/2 -translate-x-1/2 bg-bg-primary px-2 text-xs text-text-muted whitespace-nowrap">
          {label}
        </span>
      )}
    </div>
  );
}
