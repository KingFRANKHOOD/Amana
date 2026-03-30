"use client";

import React from "react";

export interface RepScoreRingProps {
  score: number;
  maxScore?: number;
  size?: "sm" | "md" | "lg" | "xl";
  animated?: boolean;
}

const SIZE_CONFIG = {
  sm: { svgSize: 64, strokeWidth: 5, radius: 26, fontSize: "text-sm", labelSize: "text-xs" },
  md: { svgSize: 96, strokeWidth: 7, radius: 38, fontSize: "text-base", labelSize: "text-xs" },
  lg: { svgSize: 128, strokeWidth: 8, radius: 52, fontSize: "text-xl", labelSize: "text-sm" },
  xl: { svgSize: 160, strokeWidth: 10, radius: 64, fontSize: "text-2xl", labelSize: "text-sm" },
} as const;

export function RepScoreRing({
  score,
  maxScore = 5,
  size = "md",
  animated = true,
}: RepScoreRingProps) {
  const clampedScore = Math.min(Math.max(score, 0), maxScore);
  const { svgSize, strokeWidth, radius, fontSize, labelSize } = SIZE_CONFIG[size];

  const circumference = 2 * Math.PI * radius;
  const fillRatio = clampedScore / maxScore;
  const dashOffset = circumference * (1 - fillRatio);
  const center = svgSize / 2;

  const scoreDisplay = clampedScore % 1 === 0
    ? clampedScore.toFixed(0)
    : clampedScore.toFixed(1);

  return (
    <div className="inline-flex flex-col items-center gap-1" role="img" aria-label={`Trust score: ${scoreDisplay} out of ${maxScore}`}>
      <svg
        width={svgSize}
        height={svgSize}
        viewBox={`0 0 ${svgSize} ${svgSize}`}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="gold-emerald-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#D4A853" />
            <stop offset="100%" stopColor="#34D399" />
          </linearGradient>
        </defs>

        {/* Track (background ring) */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(139,168,154,0.2)"
          strokeWidth={strokeWidth}
        />

        {/* Active arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="url(#gold-emerald-gradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${center} ${center})`}
          className={animated ? "transition-all duration-1000" : undefined}
          style={{ strokeDashoffset: dashOffset }}
        />

        {/* Score text — centered */}
        <text
          x={center}
          y={center}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#F0F5F1"
          fontSize={SIZE_CONFIG[size].svgSize * 0.18}
          fontWeight="600"
          fontFamily="var(--font-geist-sans), Geist, ui-sans-serif, system-ui, sans-serif"
        >
          {scoreDisplay}
        </text>
      </svg>

      <span className={`${labelSize} text-text-muted font-medium`}>
        / {maxScore}
      </span>
    </div>
  );
}

export default RepScoreRing;
