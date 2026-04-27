"use client";

import { usePathname } from "next/navigation";
import { useFreighterIdentity } from "@/hooks/useFreightonIdentity";
import { SideNavBar } from "@/components/layout/SideNavBar";
import { clsx } from "clsx";

const ROUTES_WITH_OWN_SIDEBAR = ["/assets"];

interface AppSidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function AppSidebar({ isOpen, onClose }: AppSidebarProps) {
  const pathname = usePathname();
  const { address, isAuthorized, connectWallet } = useFreighterIdentity();

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
          onClick={onClose}
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
            onClose?.();
          }}
          collapsed={false}
          walletAddress={address}
          onClose={onClose}
        />
      </div>
    </>
  );
}