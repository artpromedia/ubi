/**
 * The ONE set of marketing tokens: board 24 (city pages, driver entry, help)
 * reconciled with the homepage redesign.
 *
 * Tailwind reads this file from tailwind.config.ts, and globals.css exposes the
 * same values as `--mk-*` custom properties through `theme()`, so the plain-CSS
 * homepage and the Tailwind pages can never disagree on a colour.
 *
 * Contrast (board 24e): forest on canvas 12.9:1, ink on surface 11.2:1, muted
 * on canvas 5.0:1, on-forest on forest 12.9:1, green-ink on green 8.1:1,
 * on-forest-muted on forest 9.6:1. `mk-green` (#1DB954) is never used for
 * running text on cream; `mk-green-deep` is the text-sized green (4.8:1 on canvas).
 */
export const marketingColors = {
  "mk-canvas": "#F6F2EA",
  "mk-surface": "#FFFDF8",
  "mk-mint": "#E8F3EC",
  "mk-mint-border": "#CFE3D6",
  "mk-forest": "#10382A",
  "mk-forest-hover": "#0C2C21",
  "mk-forest-soft": "#41614F",
  "mk-ink": "#2E3B34",
  "mk-muted": "#5F6B65",
  "mk-border": "#E3DCCF",
  "mk-border-dashed": "#D6CDBC",
  "mk-divider": "#EFE9DD",
  "mk-skeleton": "#EAE4D8",
  "mk-green": "#1DB954",
  "mk-green-hover": "#18A349",
  "mk-green-ink": "#191414",
  "mk-green-deep": "#1F7A47",
  "mk-lime": "#B6DC89",
  "mk-lime-soft": "#D2E9B2",
  "mk-peach": "#F7E7D8",
  "mk-sky": "#E0ECEC",
  "mk-on-forest": "#F6F2EA",
  "mk-on-forest-muted": "#CFE3D6",
  "mk-warn-bg": "#FFF7E6",
  "mk-warn-border": "#F0D9A6",
  "mk-warn-ink": "#8A5A00",
  "mk-launch-bg": "#EBF4FF",
  "mk-launch-border": "#C9DDF3",
  "mk-launch-ink": "#2B6CB0",
} as const;

export const marketingRadius = {
  card: "20px",
  "card-lg": "24px",
  control: "12px",
  cta: "14px",
} as const;

/** Minimum hit target and CTA height (board 24: 44 px targets, 54 px CTAs). */
export const marketingSizes = {
  target: "44px",
  cta: "54px",
} as const;
