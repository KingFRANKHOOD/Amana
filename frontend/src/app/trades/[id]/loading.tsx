export default function TradeDetailLoading() {
  return (
    <div className="px-6 py-8 max-w-6xl mx-auto space-y-6 animate-pulse">
      <div className="flex items-center justify-between mb-6">
        <div className="h-8 w-48 bg-bg-card rounded-md" />
        <div className="h-8 w-28 bg-bg-card rounded-md" />
      </div>

      <div className="rounded-lg border border-border-default bg-bg-card p-5 h-32" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="h-24 rounded-lg bg-bg-card border border-border-default" />
        <div className="h-24 rounded-lg bg-bg-card border border-border-default" />
        <div className="h-24 rounded-lg bg-bg-card border border-border-default" />
      </div>

      <div className="rounded-lg border border-border-default bg-bg-card p-5 h-48" />
    </div>
  );
}
