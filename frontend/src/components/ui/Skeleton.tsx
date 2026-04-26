import { clsx } from "clsx";

type SkeletonProps = {
  className?: string;
  shimmer?: boolean;
};

export function Skeleton({ className, shimmer = true }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={clsx(
        "relative overflow-hidden rounded-md bg-bg-elevated",
        "motion-safe:animate-pulse motion-reduce:animate-none",
        shimmer &&
          "after:absolute after:inset-0 after:-translate-x-full motion-safe:after:animate-[shimmer_1.6s_infinite] after:bg-linear-to-r after:from-transparent after:via-bg-card/80 after:to-transparent",
        className,
      )}
    />
  );
}
