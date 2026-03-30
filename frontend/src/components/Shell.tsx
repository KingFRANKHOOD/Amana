import Link from "next/link";

type ShellProps = {
  children: React.ReactNode;
  topBarAction?: React.ReactNode;
};

export default function Shell({ children, topBarAction }: ShellProps) {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary font-sans">
      <nav className="border-b border-border-default px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-lg font-semibold text-gold">
          Amana
        </Link>
        <div className="flex items-center gap-6 text-sm text-text-secondary">
          {topBarAction}
          <Link href="/trades" className="hover:text-text-primary transition-colors">
            Trades
          </Link>
        </div>
      </nav>
      <main className="px-6 py-8 max-w-6xl mx-auto">{children}</main>
    </div>
  );
}
