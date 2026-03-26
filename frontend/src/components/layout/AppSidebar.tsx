"use client";

import { usePathname } from "next/navigation";
import { useFreighterIdentity } from "@/hooks/useFreighterIdentity";
import { SideNavBar } from "@/components/layout/SideNavBar";

interface AppSidebarProps {
  collapsed?: boolean;
}

export function AppSidebar({ collapsed = false }: AppSidebarProps) {
  const pathname = usePathname();
  const { address, isAuthorized, connectWallet } = useFreighterIdentity();

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
