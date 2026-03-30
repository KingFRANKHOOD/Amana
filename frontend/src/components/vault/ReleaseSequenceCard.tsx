import { BentoCard } from "@/components/ui/BentoCard";
import { SettingsIcon } from "@/components/icons";
import { Check, Clock, Flag } from "lucide-react";

type StepStatus = "completed" | "in-progress" | "pending";

interface Step {
  label: string;
  date: string;
  status: StepStatus;
}

interface ReleaseSequenceCardProps {
  sequenceId: string;
  steps: Step[];
}

export function ReleaseSequenceCard({
  sequenceId,
  steps,
}: ReleaseSequenceCardProps) {
  const getStepIcon = (status: StepStatus) => {
    switch (status) {
      case "completed":
        return <Check className="w-7 h-7 text-emerald" />;
      case "in-progress":
        return <Clock className="w-7 h-7 text-gold" />;
      case "pending":
        return <Flag className="w-7 h-7 text-text-muted" />;
    }
  };

  const getStepStyles = (status: StepStatus) => {
    switch (status) {
      case "completed":
        return "bg-emerald-muted border-emerald";
      case "in-progress":
        return "bg-gold-muted border-gold animate-pulse";
      case "pending":
        return "bg-bg-elevated border-border-default";
    }
  };

  const getTextColor = (status: StepStatus) => {
    switch (status) {
      case "completed":
        return "text-emerald";
      case "in-progress":
        return "text-gold";
      case "pending":
        return "text-text-muted";
    }
  };

  return (
    <BentoCard
      title="Release Sequence"
      icon={<SettingsIcon className="w-5 h-5" />}
      glowVariant="gold"
      className="h-full"
    >
      <div className="flex items-center justify-end mb-6">
        <span className="text-xs font-mono text-text-secondary bg-bg-elevated px-3 py-1 rounded-full border border-border-default">
          SEQUENCE_ID: {sequenceId}
        </span>
      </div>

      <div className="flex items-center justify-around">
        {steps.map((step, index) => (
          <div key={step.label} className="contents">
            <div className="flex flex-col items-center gap-3">
              <div
                className={`w-16 h-16 rounded-full border-2 flex items-center justify-center ${getStepStyles(step.status)}`}
              >
                {getStepIcon(step.status)}
              </div>
              <div className="text-center">
                <p
                  className={`text-sm font-semibold uppercase tracking-wide ${getTextColor(step.status)}`}
                >
                  {step.label}
                </p>
                <p className="text-xs text-text-secondary">{step.date}</p>
              </div>
            </div>

            {index < steps.length - 1 && (
              <div className="w-16 h-0.5 bg-border-default" />
            )}
          </div>
        ))}
      </div>
    </BentoCard>
  );
}
