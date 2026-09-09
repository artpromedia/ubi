// Semantic tokens for React Native. Values mirror packages/design-tokens (light + dark) as used on boards 1–23.
// UNVERIFIED BUILD: replace with generator output in RN-01 (scripts/generate.mjs reads the JSON and emits this file).
export const light = {
  bg: '#FFFFFF', bg2: '#F5F5F5', card: '#FFFFFF', text: '#191414', text2: '#666666', text3: '#999999',
  border: '#E5E5E5', divider: '#F0F0F0',
  primary: '#1DB954', primaryInk: '#148F3D', primaryTint: '#E8F8EE', onPrimary: '#191414', link: '#18A349',
  ok: '#148F3D', okTint: '#E8F8EE', warn: '#F5A623', warnTint: '#FEF6E8', warnInk: '#B8860B',
  error: '#E53E3E', errorTint: '#FDE8E8', errorInk: '#C53030', info: '#2B6CB0', infoTint: '#EBF4FF',
  travel: '#3182CE', travelTint: '#EBF4FF', travelInk: '#2B6CB0', bites: '#FF7545', bitesTint: '#FFF1EB', bitesInk: '#C2410C',
  send: '#10AEBA', sendTint: '#E6F7F8', sendInk: '#0E7F88', inverse: '#191414', onInverse: '#FFFFFF', onInverse2: '#A3A3A3', overlay: 'rgba(25,20,20,0.45)',
} as const;
export const dark = {
  bg: '#0A0A0A', bg2: '#171717', card: '#1A1A1A', text: '#FFFFFF', text2: '#A3A3A3', text3: '#737373',
  border: '#262626', divider: '#262626',
  primary: '#1DB954', primaryInk: '#22D66A', primaryTint: 'rgba(34,214,106,0.15)', onPrimary: '#191414', link: '#63B3ED',
  ok: '#22D66A', okTint: 'rgba(34,214,106,0.15)', warn: '#FBB034', warnTint: 'rgba(251,176,52,0.15)', warnInk: '#FBB034',
  error: '#F87171', errorTint: 'rgba(248,113,113,0.15)', errorInk: '#F87171', info: '#63B3ED', infoTint: 'rgba(99,179,237,0.15)',
  travel: '#63B3ED', travelTint: 'rgba(99,179,237,0.15)', travelInk: '#63B3ED', bites: '#FF7545', bitesTint: 'rgba(255,117,69,0.15)', bitesInk: '#FF7545',
  send: '#10AEBA', sendTint: 'rgba(16,174,186,0.15)', sendInk: '#10AEBA', inverse: '#FFFFFF', onInverse: '#191414', onInverse2: '#666666', overlay: 'rgba(0,0,0,0.6)',
} as const;
export type Colors = { [K in keyof typeof light]: string };
export type Mode = 'light' | 'dark';
export const colorsFor = (mode: Mode): Colors => (mode === 'dark' ? dark : light);
export const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40 } as const;
export const radius = { chip: 999, control: 12, card: 14, cardLg: 16, sheet: 24, sheetAndroid: 28 } as const;
export const targets = { min: 44, minAndroid: 48, primaryButton: 54 } as const;
export const fonts = { heading: 'Poppins-SemiBold', headingBold: 'Poppins-Bold', body: 'Inter-Regular', bodyMedium: 'Inter-Medium', bodySemibold: 'Inter-SemiBold', mono: 'Menlo' } as const;
export const type = {
  display: { fontFamily: fonts.heading, fontSize: 22, lineHeight: 28 },
  title: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 26 },
  heading: { fontFamily: fonts.bodySemibold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
  bodyStrong: { fontFamily: fonts.bodySemibold, fontSize: 15, lineHeight: 21 },
  bodySm: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19 },
  bodySmStrong: { fontFamily: fonts.bodySemibold, fontSize: 13, lineHeight: 19 },
  caption: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18 },
  label: { fontFamily: fonts.bodySemibold, fontSize: 11, lineHeight: 14, letterSpacing: 0.6 },
  money: { fontFamily: fonts.headingBold, fontSize: 30, lineHeight: 36, fontVariant: ['tabular-nums'] as const },
  mono: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 18 },
} as const;
