"use client";

import React from "react";
import { clsx } from "clsx";
import { Icon } from "./Icon";

export interface FormFieldProps {
  label: string;
  name: string;
  required?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactElement;
}

export function FormField({
  label,
  name,
  required,
  hint,
  error,
  className,
  children,
}: FormFieldProps) {
  const hintId = `${name}-hint`;
  const errorId = `${name}-error`;

  // When error is present, hint is hidden (InputField L92 pattern).
  // aria-describedby references only the visible descriptor.
  const describedBy = error ? errorId : hint ? hintId : undefined;

  // Inject id, aria-describedby, and aria-invalid into the child element
  const enhanced = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        id: name,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })
    : children;

  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={name}
        className="text-text-secondary text-sm font-medium"
      >
        {label}
        {required && <span className="text-gold"> *</span>}
      </label>

      {enhanced}

      {!error && hint && (
        <p id={hintId} className="text-text-muted text-xs">
          {hint}
        </p>
      )}

      {error && (
        <p
          id={errorId}
          className="text-status-danger text-xs mt-1 flex items-center gap-1"
        >
          <Icon name="alert-circle" size="xs" className="text-status-danger" />
          {error}
        </p>
      )}
    </div>
  );
}
