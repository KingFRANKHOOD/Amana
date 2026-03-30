// src/app/layout.tsx
import type { Metadata } from "next";
import { Manrope } from "next/font/google";

import "./globals.css";
import { TopNav } from "@/components/TopNav";
import { Geist, Geist_Mono } from "next/font/google";
import { AppTopNav } from "@/components/layout/AppTopNav";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AuthProvider } from "@/hooks/useAuth";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const manrope = Manrope({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-manrope',
});

export const metadata: Metadata = {
  title: "Amana — Secure Agricultural Escrow",
  description: "Blockchain-powered agricultural trade settlement",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${manrope.variable} font-sans bg-primary text-text-primary antialiased`}
      >
        <AuthProvider>
          <TopNav title="Amana" networkStatus="testnet" />
          <div className="flex flex-col h-screen">
            <AppTopNav />
            <div className="flex flex-1 overflow-hidden">
              <AppSidebar />
              <main className="flex-1 overflow-y-auto">{children}</main>
            </div>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
