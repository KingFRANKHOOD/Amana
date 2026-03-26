import { clsx } from "clsx";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "sm" | "md" | "lg";
    loading?: boolean;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
    fullWidth?: boolean;
}

export function Button({
    variant = "primary",
    size = "sm",
    loading = false,
    disabled,
    leftIcon,
    rightIcon,
    fullWidth,
    children,
    className,

    ...props
}: ButtonProps) {
    const isDisabled = disabled || loading;

    const variants = {
        primary: "bg-gradient-gold-cta text-inverse hover:shadow-glow-gold",
        secondary:
            "bg-transparent border border-gold text-gold hover:bg-gold-muted",
        ghost: "No border/bg, text-muted hover:bg-white/5",
        danger: "bg-status-danger text-white",
    };

    const sizes = {
        sm: "h-8 text-sm",
        md: "h-10 text-base",
        lg: "h-12 text-lg",
    };

    return (
        <button
            role="button"
            className={clsx(
                "inline-flex items-center justify-center gap-2 px-6 py-4 cursor-pointer",
                "rounded-full font-medium",
                "transition-all duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                variants[variant],
                sizes[size],
                fullWidth && "w-full",
                className,
            )}
            disabled={isDisabled}
            aria-disabled={isDisabled}
            {...props}
        >
            {loading && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            )}

            <span>{children}</span>
        </button>
    );
}
