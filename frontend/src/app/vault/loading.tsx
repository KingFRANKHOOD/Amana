export default function VaultLoading() {
  return (
    <section className="min-h-full bg-bg-primary px-6 py-8 lg:px-10 animate-pulse">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="h-20 rounded-2xl border border-border-default bg-card" />
        <div className="h-32 rounded-2xl border border-border-default bg-card" />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="md:col-span-2 h-64 rounded-2xl border border-border-default bg-card" />
          <div className="h-64 rounded-2xl border border-border-default bg-card" />

          <div className="md:col-span-2 h-80 rounded-2xl border border-border-default bg-card" />
          <div className="h-80 rounded-2xl border border-border-default bg-card" />

          <div className="md:col-span-2 lg:col-span-3 h-32 rounded-2xl border border-border-default bg-card" />
        </div>

        <div className="h-20 rounded-2xl border border-border-default bg-card" />
      </div>
    </section>
  );
}
