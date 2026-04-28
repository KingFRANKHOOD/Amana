import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Surface / Elevation scale ──────────────────────────────────────
        // surface-0  page canvas (deepest background)
        // surface-1  card / panel (one step up)
        // surface-2  elevated surface — active rows, modals, dropdowns
        // surface-3  overlay / scrim
        "surface-0": "#0B1A14",
        "surface-1": "#122A1F",
        "surface-2": "#1A3D2C",
        "surface-3": "rgba(11,26,20,0.85)",

        // Legacy bg-* aliases — kept for backward-compat, map to surface tokens
        "bg-primary":  "#0B1A14",             // → surface-0
        "bg-card":     "#122A1F",             // → surface-1
        "bg-elevated": "#1A3D2C",             // → surface-2
        "bg-input":    "#0F2219",
        "bg-overlay":  "rgba(11,26,20,0.85)", // → surface-3

        gold: "#D4A853",
        "gold-hover": "#E0BA6A",
        "gold-muted": "rgba(212,168,83,0.15)",
        emerald: "#34D399",
        "emerald-muted": "rgba(52,211,153,0.15)",
        "accent-emerald": "#34D399",
        teal: "#14B8A6",
        "text-primary":   "#F0F5F1",
        "text-secondary": "#8BA89A",
        "text-muted":     "#5A7A6A",
        "text-inverse":   "#0B1A14",

        // Status chip tokens
        "status-success": "#34D399",
        "status-warning": "#F59E0B",
        "status-danger":  "#EF4444",
        "status-info":    "#3B82F6",
        "status-locked":  "#D4A853",
        "status-draft":   "#6B7280",

        // ── Border tokens — elevation-aware ───────────────────────────────
        "border-subtle":  "rgba(139,168,154,0.12)", // surface-0 dividers
        "border-default": "rgba(139,168,154,0.2)",  // surface-1 card borders
        "border-raised":  "rgba(139,168,154,0.32)", // surface-2 elevated borders
        "border-hover":   "rgba(139,168,154,0.4)",
        "border-focus":   "rgba(212,168,83,0.6)",
      },
      backgroundColor: {
        // Surface scale
        "surface-0": "#0B1A14",
        "surface-1": "#122A1F",
        "surface-2": "#1A3D2C",
        "surface-3": "rgba(11,26,20,0.85)",
        // Legacy aliases
        primary:  "#0B1A14",
        card:     "#122A1F",
        elevated: "#1A3D2C",
        input:    "#0F2219",
        overlay:  "rgba(11,26,20,0.85)",
      },
      textColor: {
        primary:   "#F0F5F1",
        secondary: "#8BA89A",
        muted:     "#5A7A6A",
        inverse:   "#0B1A14",
      },
      borderColor: {
        subtle:  "rgba(139,168,154,0.12)",
        default: "rgba(139,168,154,0.2)",
        raised:  "rgba(139,168,154,0.32)",
        hover:   "rgba(139,168,154,0.4)",
        focus:   "rgba(212,168,83,0.6)",
      },
      // ── Elevation / shadow scale ─────────────────────────────────────────
      // elev-0  flat — surface-0 canvas, no lift
      // elev-1  subtle lift — cards, panels, sidebar (surface-1)
      // elev-2  raised — active rows, dropdowns, modals (surface-2)
      // elev-3  overlay — dialogs, scrim (surface-3)
      boxShadow: {
        "elev-0": "none",
        "elev-1": "0 1px 4px rgba(0,0,0,0.25), 0 4px 24px rgba(0,0,0,0.3)",
        "elev-2": "0 4px 12px rgba(0,0,0,0.35), 0 8px 32px rgba(0,0,0,0.4)",
        "elev-3": "0 16px 48px rgba(0,0,0,0.5)",
        // Legacy aliases
        card:           "0 1px 4px rgba(0,0,0,0.25), 0 4px 24px rgba(0,0,0,0.3)",
        "card-hover":   "0 4px 12px rgba(0,0,0,0.35), 0 8px 32px rgba(0,0,0,0.4)",
        "glow-gold":    "0 0 20px rgba(212,168,83,0.2)",
        "glow-emerald": "0 0 20px rgba(52,211,153,0.15)",
        modal:          "0 16px 48px rgba(0,0,0,0.5)",
      },
      spacing: {
        1: "4px",
        2: "8px",
        3: "12px",
        4: "16px",
        5: "20px",
        6: "24px",
        8: "32px",
        10: "40px",
      },
      borderRadius: {
        none:  "0",
        sm:    "6px",
        md:    "8px",
        lg:    "12px",
        xl:    "16px",
        "2xl": "24px",
        full:  "9999px",
      },
      fontFamily: {
        sans: [
          "var(--font-geist-sans)",
          "Geist",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        manrope: ["var(--font-manrope)", "Manrope", "sans-serif"],
        mono: [
          "var(--font-geist-mono)",
          "Geist Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
          "Courier New",
          "monospace",
        ],
      },
      // #444 — Figma type scale tokens: display → 3xl → 2xl → xl for headings;
      // lg → base → sm for body and metadata. No ad-hoc sizes in components.
      fontSize: {
        xs:      ["12px", { lineHeight: "1.5" }],
        sm:      ["14px", { lineHeight: "1.5" }],
        base:    ["16px", { lineHeight: "1.5" }],
        lg:      ["18px", { lineHeight: "1.6" }],
        xl:      ["20px", { lineHeight: "1.4" }],
        "2xl":   ["24px", { lineHeight: "1.3" }],
        "3xl":   ["30px", { lineHeight: "1.25" }],
        "4xl":   ["36px", { lineHeight: "1.2" }],
        "5xl":   ["48px", { lineHeight: "1.15" }],
        display: ["60px", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
      },
      lineHeight: {
        tight:   "1.2",
        normal:  "1.5",
        relaxed: "1.75",
      },
      backgroundImage: {
        "gradient-hero":
          "linear-gradient(135deg, #0B1A14 0%, #122A1F 50%, #1A3D2C 100%)",
        "gradient-gold-cta":
          "linear-gradient(135deg, #D4A853 0%, #E0BA6A 100%)",
        "gradient-card-glow":
          "linear-gradient(135deg, rgba(52,211,153,0.05) 0%, rgba(212,168,83,0.05) 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
