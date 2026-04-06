import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { LoadingState } from "@/components/ui/LoadingState";

const SAMPLE_ICONS = [
  "shield",
  "check-circle",
  "alert-triangle",
  "truck",
  "file-text",
  "lock",
  "unlock",
  "user",
  "star",
  "arrow-right",
  "clock",
  "x-circle",
];

export default function IconDevPage() {
  return (
    <div className="min-h-screen bg-primary p-10">
      <h1 className="text-2xl font-bold text-gold mb-2">Icon Component</h1>
      <p className="text-text-secondary text-sm mb-8">
        Sizes: xs=12px · sm=16px · md=20px · lg=24px
      </p>

      {/* Size showcase */}
      <section className="mb-10">
        <h2 className="text-xs font-semibold tracking-widest text-text-muted mb-4 uppercase">
          Sizes
        </h2>
        <div className="flex items-end gap-6">
          {(["xs", "sm", "md", "lg"] as const).map((s) => (
            <div key={s} className="flex flex-col items-center gap-2">
              <Icon name="shield" size={s} className="text-gold" />
              <span className="text-xs text-text-muted">{s}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Color inheritance */}
      <section className="mb-10">
        <h2 className="text-xs font-semibold tracking-widest text-text-muted mb-4 uppercase">
          Color via className
        </h2>
        <div className="flex items-center gap-5">
          <Icon name="check-circle" size="md" className="text-emerald" />
          <Icon
            name="alert-triangle"
            size="md"
            className="text-status-warning"
          />
          <Icon name="x-circle" size="md" className="text-status-danger" />
          <Icon name="lock" size="md" className="text-gold" />
          <Icon name="user" size="md" />
          {/* ↑ no className → falls back to text-text-secondary */}
        </div>
      </section>

      {/* Aria-label (accessible icon-only button) */}
      <section className="mb-10">
        <h2 className="text-xs font-semibold tracking-widest text-text-muted mb-4 uppercase">
          Accessible icon-only button
        </h2>
        <button
          className="w-9 h-9 rounded-lg bg-elevated border border-border-default flex items-center justify-center hover:border-border-hover transition-all"
          aria-label="Open notifications"
        >
          <Icon name="bell" size="sm" aria-label="Open notifications" />
        </button>
      </section>

      {/* All sample icons */}
      <section>
        <h2 className="text-xs font-semibold tracking-widest text-text-muted mb-4 uppercase">
          Sample icons (sm)
        </h2>
        <div className="flex flex-wrap gap-4">
          {SAMPLE_ICONS.map((n) => (
            <div
              key={n}
              className="flex flex-col items-center gap-2 bg-card border border-border-default rounded-lg p-3"
            >
              <Icon name={n} size="sm" className="text-text-primary" />
              <span className="text-xs text-text-muted font-mono">{n}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Spinner ──────────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="text-xs font-semibold tracking-widest text-text-muted mb-4 uppercase">
          Spinner — sizes
        </h2>
        <div className="flex items-center gap-8">
          {(["sm", "md", "lg"] as const).map((s) => (
            <div key={s} className="flex flex-col items-center gap-3">
              <Spinner size={s} />
              <span className="text-xs text-text-muted">{s}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-xs font-semibold tracking-widest text-text-muted mb-4 uppercase">
          Spinner — inside a button
        </h2>
        <button
          disabled
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-gold-cta text-text-inverse text-sm font-bold opacity-60 cursor-not-allowed"
        >
          <Spinner size="sm" />
          Confirming…
        </button>
      </section>

      {/* ── LoadingState ─────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="text-xs font-semibold tracking-widest text-text-muted mb-4 uppercase">
          LoadingState — card skeleton
        </h2>
        <div className="max-w-sm">
          <LoadingState variant="card" rows={4} />
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-xs font-semibold tracking-widest text-text-muted mb-4 uppercase">
          LoadingState — row skeleton
        </h2>
        <div className="max-w-sm flex flex-col gap-2">
          <LoadingState variant="row" />
          <LoadingState variant="row" />
          <LoadingState variant="row" />
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-xs font-semibold tracking-widest text-text-muted mb-4 uppercase">
          LoadingState — inline skeleton
        </h2>
        <div className="max-w-xs">
          <LoadingState variant="inline" />
        </div>
      </section>
    </div>
  );
}
