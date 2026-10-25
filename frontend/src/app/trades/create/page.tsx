"use client";
import { TradeProvider, TradeDataSchema, useTradeStep, useTradeData, type TradeData } from "./TradeContext";
import { useDraftForm } from "@/hooks/useDraftForm";
import Step1Details from "./steps/Step1Details";
import Step2Negotiation from "./steps/Step2Negotiation";
import Step3Review from "./steps/Step3Review";
import Link from "next/link";

const STEPS = [
  { index: 1, label: "Details" },
  { index: 2, label: "Negotiation" },
  { index: 3, label: "Review" },
];

function StepIndicator() {
  const { step } = useTradeStep();
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map(({ index, label }, i) => (
        <div key={index} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                step === index
                  ? "bg-gold text-text-inverse"
                  : step > index
                  ? "bg-emerald text-text-inverse"
                  : "bg-bg-elevated text-text-muted border border-border-default"
              }`}
            >
              {step > index ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                index
              )}
            </div>
            <span className={`text-xs ${step >= index ? "text-text-secondary" : "text-text-muted"}`}>
              {label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`flex-1 h-px mx-2 mb-4 transition-colors ${step > index ? "bg-emerald" : "bg-border-default"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function CreateTradeInner() {
  const { step } = useTradeStep();
  const draft = useDraftForm<TradeData>("trade:create", TradeDataSchema);
  const { update } = useTradeData();
  const drafts = draft.list();
  const hasDrafts = drafts.length > 0;

  function handleRestoreLatest() {
    const loaded = draft.load();
    if (loaded) update(loaded);
  }
  return (
    <div className="min-h-screen bg-bg-primary flex items-start justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        {hasDrafts && (
          <div className="mb-4 p-3 rounded-lg bg-bg-elevated border border-border-default flex items-center justify-between">
            <div className="text-sm text-text-secondary">You have an unsaved trade draft. Restore it?</div>
            <div className="flex gap-2">
              <button onClick={() => handleRestoreLatest()} className="px-3 py-1 bg-gold text-text-inverse rounded-md text-sm">Restore</button>
              <button onClick={() => draft.clear()} className="px-3 py-1 bg-bg-card border border-border-default rounded-md text-sm">Dismiss</button>
            </div>
          </div>
        )}
        <div className="mb-6">
          <Link href="/" className="text-text-muted text-sm hover:text-text-secondary transition-colors">
            ← Back
          </Link>
        </div>

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary">Create Trade</h1>
          <p className="text-text-secondary text-sm mt-1">
            Lock agricultural commodity value into cNGN escrow via NGN Path Payment
          </p>
        </div>

        <div className="bg-bg-card rounded-xl border border-border-default p-6 shadow-card">
          <StepIndicator />
          {step === 1 && <Step1Details />}
          {step === 2 && <Step2Negotiation />}
          {step === 3 && <Step3Review />}
        </div>
      </div>
    </div>
  );
}

export default function CreateTradePage() {
  return (
    <TradeProvider>
      <CreateTradeInner />
    </TradeProvider>
  );
}
