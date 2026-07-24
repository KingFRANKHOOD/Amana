"use client";

import { usePathname } from "next/navigation";
import { useFreighterIdentity } from "@/hooks/useFreighterIdentity";
import { SideNavBar } from "@/components/layout/SideNavBar";
import { useSidebarState } from "@/components/layout/SidebarStateProvider";
import { clsx } from "clsx";

const ROUTES_WITH_OWN_SIDEBAR = ["/assets"];

export function AppSidebar() {
  const pathname = usePathname();
  const { address, isAuthorized, connectWallet } = useFreighterIdentity();
  const { isOpen, close } = useSidebarState();

  const hasOwnSidebar = ROUTES_WITH_OWN_SIDEBAR.some(
    (route) => pathname === route || pathname?.startsWith(`${route}/`),
  );

  if (hasOwnSidebar) return null;

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-bg-overlay z-40 lg:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      {/* Sidebar - visible on desktop, drawer on mobile */}
      <div
        className={clsx(
          "fixed lg:static inset-y-0 left-0 z-50 transform transition-transform duration-300 lg:transform-none",
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <SideNavBar
          activePath={pathname ?? ""}
          isConnected={isAuthorized}
          onConnectWallet={() => {
            void connectWallet();
            close();
          }}
          collapsed={false}
          walletAddress={address}
          onClose={close}
        />
      </div>
    </>
  );
}
