// Add to apps/marketing-site/tailwind.config.ts theme.extend (alongside the existing ubi-* colours)
export const marketingExtend = {
  colors: {
    'mk-canvas': '#F6F2EA', 'mk-surface': '#FFFDF8', 'mk-mint': '#E8F3EC', 'mk-mint-border': '#CFE3D6',
    'mk-forest': '#10382A', 'mk-ink': '#2E3B34', 'mk-muted': '#5F6B65', 'mk-border': '#E3DCCF', 'mk-border-dashed': '#D6CDBC', 'mk-divider': '#EFE9DD', 'mk-skeleton': '#EAE4D8',
    'mk-on-forest': '#F6F2EA', 'mk-on-forest-muted': '#CFE3D6', 'mk-warn-bg': '#FFF7E6', 'mk-warn-border': '#F0D9A6', 'mk-warn-ink': '#8A5A00',
  },
  borderRadius: { card: '20px', 'card-lg': '24px', cta: '14px' },
  fontFamily: { heading: ['Poppins', 'var(--font-inter)', 'system-ui', 'sans-serif'] },
  minHeight: { target: '44px', cta: '54px' },
} as const;
