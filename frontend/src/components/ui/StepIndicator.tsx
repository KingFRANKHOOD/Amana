"use client";

import React from "react";
import { Icon } from "./Icon";

export interface Step {
  label: string;
  description?: string;
}

export interface StepIndicatorProps {
  steps: Step[];
  currentStep: number; // 0-indexed
  completedSteps?: number[];
  className?: string;
}

export const StepIndicator: React.FC<StepIndicatorProps> = ({
  steps,
  currentStep,
  completedSteps = [],
  className = "",
}) => {
  return (
    <nav 
      aria-label="Progress"
      className={`flex w-full items-start justify-between ${className}`}
    >
      {steps.map((step, index) => {
        const isCompleted = completedSteps.includes(index) || index < currentStep;
        const isCurrent = index === currentStep;
        const isUpcoming = !isCompleted && !isCurrent;
        
        // Final circle style
        let circleClass = "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base transition-all duration-200 z-10 ";
        let content: React.ReactNode;

        if (isCompleted) {
          circleClass += "bg-accent-emerald text-inverse";
          content = <Icon name="check" size="sm" className="text-inverse" />;
        } else if (isCurrent) {
          circleClass += "border-2 border-gold font-bold text-gold bg-bg-primary";
          content = index + 1;
        } else {
          circleClass += "border-2 border-border-default text-text-muted bg-bg-primary";
          content = index + 1;
        }

        return (
          <div 
            key={index} 
            className={`flex items-center ${index < steps.length - 1 ? "flex-1" : ""}`}
            aria-current={isCurrent ? "step" : undefined}
          >
            {/* Step circle and Label */}
            <div className="flex flex-col items-center relative gap-2">
              <div className={circleClass} title={step.label}>
                {content}
              </div>
              
              {/* Label below the circle */}
              <div className="absolute top-12 flex flex-col items-center w-max min-w-[60px] max-w-[120px]">
                <span className={`text-sm font-medium transition-colors text-center w-full truncate ${isCurrent ? "text-gold" : isCompleted ? "text-primary" : "text-text-muted"}`}>
                  {step.label}
                </span>
                {step.description && (
                  <span className="hidden text-xs text-text-muted sm:block truncate w-full text-center">
                    {step.description}
                  </span>
                )}
              </div>
            </div>

            {/* Connecting line between steps */}
            {index < steps.length - 1 && (
              <div className="mx-2 h-0.5 w-full bg-border-default self-center -translate-y-[10px]">
                <div 
                  className={`h-full transition-all duration-500 ease-in-out ${
                    index < currentStep || (completedSteps.includes(index) && completedSteps.includes(index + 1))
                      ? "w-full bg-accent-emerald"
                      : "w-0"
                  }`}
                />
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
};
