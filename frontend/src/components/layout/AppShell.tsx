"use client";

import { useState } from "react";
import { AppTopNav } from "@/components/layout/AppTopNav";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { useFreighterIdentity } from "@/hooks/useFreightonIdentity";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { isAuthorized } = useFreighterIdentity();

  return (
    <div className="flex flex-col h-screen">
      <AppTopNav
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        isSidebarOpen={sidebarOpen}
      />
      <div className="flex flex-1 overflow-hidden">
        <AppSidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <main className="flex-1 overflow-y-auto h-full">{children}</main>
      </div>
    </div>
  );
}