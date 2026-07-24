// src/app/layout.tsx
import type { Metadata } from "next";
import { Manrope } from "next/font/google";

import "./globals.css";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/layout/AppShell";
import { AuthProvider } from "@/hooks/useAuth";
import { AnalyticsProvider } from "@/components/AnalyticsProvider";
import { ToastContainer } from "@/components/ui/ToastContainer";
import { ToastProvider } from "@/hooks/useToast";
import RegisterSW from "@/components/RegisterSW";
import { LocaleSync } from "@/components/LocaleSync";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-manrope",
});

export const metadata: Metadata = {
  title: "Amana — Secure Agricultural Escrow",
  description: "Blockchain-powered agricultural trade settlement",
  manifest: "/manifest.json",
  themeColor: "#1a3a1a",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Amana",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
  },
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
        <AnalyticsProvider>
          <AuthProvider>
            <ToastProvider>
              <LocaleSync />
              <AppShell>{children}</AppShell>
              <RegisterSW />
              <ToastContainer />
            </ToastProvider>
          </AuthProvider>
        </AnalyticsProvider>
      </body>
    </html>
  );
}