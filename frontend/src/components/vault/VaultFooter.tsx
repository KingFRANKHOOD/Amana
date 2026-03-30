"use client";

import { Check } from "lucide-react";
import {
  XIcon,
  InstagramIcon,
  TiktokIcon,
  DiscordIcon,
} from "@/components/icons";

interface FooterLink {
  label: string;
  href: string;
}

interface SocialLink {
  platform: "x" | "instagram" | "tiktok" | "discord";
  href: string;
}

interface VaultFooterProps {
  version: string;
  links: FooterLink[];
  socialLinks: SocialLink[];
}

const socialIcons = {
  x: XIcon,
  instagram: InstagramIcon,
  tiktok: TiktokIcon,
  discord: DiscordIcon,
};

export function VaultFooter({ version, links, socialLinks }: VaultFooterProps) {
  return (
    <footer className="mt-16 pt-8 border-t border-border-default">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 text-xs text-text-secondary mb-2">
            <Check className="w-4 h-4" />
            <span>Amana Digital Custody Systems {version}</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-text-secondary">
            {links.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="hover:text-text-primary transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs text-gold uppercase tracking-widest mb-3">
            Connect With Us
          </p>
          <div className="flex items-center gap-3">
            {socialLinks.map((social) => {
              const Icon = socialIcons[social.platform];
              return (
                <a
                  key={social.platform}
                  href={social.href}
                  className="w-10 h-10 rounded-full bg-bg-elevated border border-border-default flex items-center justify-center hover:border-border-hover transition-colors"
                >
                  <Icon className="w-4 h-4 text-text-primary" />
                </a>
              );
            })}
          </div>
        </div>
      </div>
    </footer>
  );
}