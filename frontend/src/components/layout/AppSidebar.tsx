"use client";

import { usePathname } from "next/navigation";
import { useFreighterIdentity } from "@/hooks/useFreighterIdentity";
import { SideNavBar } from "@/components/layout/SideNavBar";

// Routes that render their own contextual sidebar
const ROUTES_WITH_OWN_SIDEBAR = ["/assets"];

interface AppSidebarProps {
  collapsed?: boolean;
}

export function AppSidebar({ collapsed = false }: AppSidebarProps) {
  const pathname = usePathname();
  const { address, isAuthorized, connectWallet } = useFreighterIdentity();

  // Hide the global sidebar on pages that have their own contextual sidebar
  const hasOwnSidebar = ROUTES_WITH_OWN_SIDEBAR.some(
    (route) => pathname === route || pathname?.startsWith(`${route}/`),
  );

  if (hasOwnSidebar) return null;

  return (
    <SideNavBar
      activePath={pathname ?? ""}
      isConnected={isAuthorized}
      onConnectWallet={() => void connectWallet()}
      collapsed={collapsed}
      walletAddress={address}
    />
  );
}
