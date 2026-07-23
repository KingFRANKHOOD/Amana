import { BentoCard } from "@/components/ui/BentoCard";
import { Shield, Fingerprint, Database } from "lucide-react";
import type { ReactNode } from "react";
import Image from "next/image";
import RequestIcon from "@/app/assets/RequestIcon.png";

type LogType = "biometric" | "multi-sig" | "ledger";

interface AuditLogEntry {
  type: LogType;
  title: string;
  metadata: string;
}

interface AuditLogCardProps {
  entries: AuditLogEntry[];
  isLiveSync?: boolean;
  emptyMessage?: string;
}

const logIcons: Record<LogType, ReactNode> = {
  biometric: <Fingerprint className="w-4 h-4 text-emerald" aria-hidden="true" />,
  "multi-sig": <Image src={RequestIcon} alt="" aria-hidden="true" />,
  ledger: <Database className="w-4 h-4 text-text-secondary" aria-hidden="true" />,
};

const logBgColors: Record<LogType, string> = {
  biometric: "bg-emerald-muted",
  "multi-sig": "bg-gold-muted",
  ledger: "bg-bg-elevated",
};

export function AuditLogCard({
  entries,
  isLiveSync = true,
  emptyMessage = "Audit log source is coming soon.",
}: AuditLogCardProps) {
  return (
    <BentoCard
      title="Audit Log"
      icon={<Shield className="w-5 h-5" />}
      glowVariant="emerald"
      className="h-full"
    >
      <div className="flex items-center justify-end -mt-8 mb-6">
        {isLiveSync && (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald bg-emerald-muted px-3 py-1 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald animate-pulse" aria-hidden="true" />
            Live Sync
          </span>
        )}
      </div>

      <div className="space-y-4">
        {entries.length > 0 ? (
          entries.map((entry, index) => (
            <div key={index} className="flex items-start gap-3 bg-[#03110B4D] p-4 rounded-lg h-18">
              <div
                className={`w-10 h-10 rounded-full ${logBgColors[entry.type]} flex items-center justify-center shrink-0 mb-12`}
              >
                {logIcons[entry.type]}
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary">
                  {entry.title}
                </p>
                <p className="text-xs text-text-secondary">{entry.metadata}</p>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-border-default bg-bg-elevated p-4">
            <p className="text-sm font-medium text-text-primary">
              Audit trail unavailable
            </p>
            <p className="mt-1 text-xs text-text-secondary">{emptyMessage}</p>
          </div>
        )}
      </div>
    </BentoCard>
  );
}
