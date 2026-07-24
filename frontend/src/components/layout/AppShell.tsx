// Server component — no "use client" directive.
// Children (pages) remain RSC-eligible and can stream independently.
import { SidebarStateProvider } from "@/components/layout/SidebarStateProvider";
import { AppTopNav } from "@/components/layout/AppTopNav";
import { AppSidebar } from "@/components/layout/AppSidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarStateProvider>
      <div className="flex flex-col h-screen">
        <AppTopNav />
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <main className="flex-1 overflow-y-auto h-full">{children}</main>
        </div>
      </div>
    </SidebarStateProvider>
  );
}
