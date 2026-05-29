"use client";

import React from "react";

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: "primary" | "secondary";
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
  className?: string;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonProps) {
  const baseStyles = "font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2 disabled:opacity-60 disabled:cursor-not-allowed";
  
  const variantStyles = {
    primary: "bg-gold text-text-inverse hover:bg-gold-hover",
    secondary: "bg-bg-elevated text-text-primary border border-border-default hover:border-border-hover",
  };
  
  const sizeStyles = {
    sm: "px-3 py-1.5 text-sm rounded-md",
    md: "px-4 py-2 text-sm rounded-md",
    lg: "px-6 py-3 text-sm rounded-lg",
  };
  
  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
