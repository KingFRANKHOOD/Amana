"use client";

import React, { useEffect, useState } from "react";
import { CheckCircle, AlertTriangle, XCircle, Info, X } from "lucide-react";
import { ToastMessage } from "@/types/toast";
import { clsx } from "clsx";

interface ToastProps extends ToastMessage {
  onClose: (id: string) => void;
}

export function Toast({
  id,
  type,
  title,
  message,
  duration = 4000,
  onClose,
}: ToastProps) {
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        handleClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration]);

  const handleClose = () => {
    setIsClosing(true);
    // Wait for the slide-out/fade-out animation to finish before actually removing it
    setTimeout(() => {
      onClose(id);
    }, 300); // 300ms matches our transition duration
  };

  const IconMap = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertTriangle,
    info: Info,
  };

  const Icon = IconMap[type];

  // Base styling for the toast
  const baseClasses =
    "pointer-events-auto flex w-full max-w-md rounded-lg shadow-card ring-1 ring-black/5 p-4 transition-all duration-300 transform items-start gap-3 relative overflow-hidden backdrop-blur-md";

  // Animation classes
  const animationClasses = isClosing
    ? "opacity-0 translate-x-full"
    : "opacity-100 translate-x-0";

  // Type-specific colors using our tailwind tokens
  const typeClasses = {
    success: "bg-bg-elevated/95 border border-status-success/30 text-text-primary",
    error: "bg-status-danger/10 border border-status-danger/40 text-text-primary",
    warning: "bg-status-warning/10 border border-status-warning/40 text-text-primary",
    info: "bg-status-info/10 border border-status-info/40 text-text-primary",
  };

  const iconColors = {
    success: "text-status-success",
    error: "text-status-danger",
    warning: "text-status-warning",
    info: "text-status-info",
  };

  return (
    <div
      className={clsx(
        baseClasses,
        animationClasses,
        typeClasses[type]
      )}
      role="alert"
    >
      <Icon className={clsx("h-6 w-6 shrink-0", iconColors[type])} />
      <div className="flex-1 pt-0.5">
        {title && <h3 className="text-sm font-semibold mb-1">{title}</h3>}
        <p className="text-sm text-text-secondary">{message}</p>
      </div>
      <button
        onClick={handleClose}
        className="shrink-0 ml-4 rounded-md p-1.5 inline-flex text-text-muted hover:text-text-primary hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-border-focus"
        aria-label="Close"
      >
        <span className="sr-only">Close</span>
        <X className="h-4 w-4" />
      </button>
      
      {/* Optional: subtle progress bar for auto-dismiss */}
      {duration > 0 && (
        <div 
          className={clsx(
            "absolute bottom-0 left-0 h-1 bg-current opacity-20",
          )}
          style={{
            width: "100%",
            animation: `shrink ${duration}ms linear forwards`,
          }}
        />
      )}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes shrink {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}} />
    </div>
  );
}
