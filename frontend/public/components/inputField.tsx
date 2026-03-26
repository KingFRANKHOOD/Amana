"use client";

import React, { useId } from "react";
import { clsx } from "clsx";

interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    hint?: string;
    leftSlot?: React.ReactNode;
    rightSlot?: React.ReactNode;
    fullWidth?: boolean;
}

export function InputField({
    label,
    error,
    hint,
    leftSlot,
    rightSlot,
    fullWidth,
    className,
    id,
    disabled,
    ...props
}: InputFieldProps) {
    const generatedId = useId();
    const inputId = id || generatedId;

    const describedBy = clsx(
        error && `${inputId}-error`,
        hint && `${inputId}-hint`,
    );

    return (
        <div className={clsx("flex flex-col gap-1.5", fullWidth && "w-full")}>
            {label && (
                <label
                    htmlFor={inputId}
                    className="text-text-secondary text-sm font-medium"
                >
                    {label}
                </label>
            )}

            <div
                className={clsx(
                    "relative flex items-center rounded-md",
                    "bg-input border border-border-default",
                    "focus-within:border-border-focus",
                    "transition-all duration-150",

                    error && "border-status-danger",
                    disabled && "opacity-50 cursor-not-allowed bg-card",
                )}
            >
                {leftSlot && (
                    <span className="absolute left-3 flex items-center select-none">
                        {leftSlot}
                    </span>
                )}

                <input
                    id={inputId}
                    disabled={disabled}
                    aria-invalid={!!error}
                    aria-describedby={describedBy || undefined}
                    className={clsx(
                        "w-full bg-transparent outline-none rounded-md",
                        "py-2 text-sm",
                        "placeholder:text-muted",
                        "focus:ring-2 focus:ring-border-focus/50",

                        leftSlot && "pl-10",
                        rightSlot && "pr-10",
                        !leftSlot && "pl-3",
                        !rightSlot && "pr-3",
                        disabled && "cursor-not-allowed",

                        className,
                    )}
                    {...props}
                />

                {rightSlot && (
                    <span className="absolute right-3 flex items-center select-none font-semibold">
                        {rightSlot}
                    </span>
                )}
            </div>

            {!error && hint && (
                <p id={`${inputId}-hint`} className="text-xs text-muted">
                    {hint}
                </p>
            )}

            {error && (
                <p
                    id={`${inputId}-error`}
                    className="text-xs text-status-danger"
                >
                    {error}
                </p>
            )}
        </div>
    );
}
