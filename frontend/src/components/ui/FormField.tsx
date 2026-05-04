"use client";

import React, { useId } from "react";
import { clsx } from "clsx";

interface FormFieldProps {
  label: string;
  name: string;
  required?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactElement;
}

export type { FormFieldProps };

interface FieldChildProps {
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
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
  const generatedId = useId();
  const inputId = `${name}-${generatedId}`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  const child = React.Children.only(
    children,
  ) as React.ReactElement<FieldChildProps>;
  const childWithProps = React.cloneElement(child, {
    id: inputId,
    "aria-invalid": !!error,
    "aria-describedby": clsx(error && errorId, hint && hintId),
  });

  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={inputId}
        className="text-sm font-medium text-text-secondary"
      >
        {label}
        {required && <span className="text-gold ml-0.5">*</span>}
      </label>
      {childWithProps}
      {!error && hint && (
        <p id={hintId} className="text-muted text-xs">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          className="text-status-danger text-xs mt-1 flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}
