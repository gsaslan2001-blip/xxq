/* --- THEME & FONT TOKENS — Ultra Premium Design System --- */

export const themeColors = {
  dark: {
    bg: 'bg-[#000000]',
    card: 'bg-[#0a0a0a]/90 backdrop-blur-3xl shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_0_1px_rgba(255,255,255,0.04)]',
    cardSolid: 'bg-[#0a0a0a] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_0_1px_rgba(255,255,255,0.04)]',
    cardGlass: 'bg-[#111111]/40 backdrop-blur-3xl shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_0_0_1px_rgba(255,255,255,0.05)]',
    cardHover: 'hover:bg-[#111111]/90 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_0_1px_rgba(255,255,255,0.08),0_4px_16px_rgba(0,0,0,0.4)] hover:-translate-y-[1px]',
    surface: 'bg-[#141414]',
    border: 'border-white/[0.04]',
    text: 'text-[#f5f5f5]',
    subtext: 'text-[#888888]',
    headerBg: 'bg-[#000000]/70',
    accent: 'text-[#5e6ad2]',
    accentBg: 'bg-[#5e6ad2]',
    accentSoft: 'bg-[#5e6ad2]/10 text-[#717bf5]',
    ring: 'ring-[#5e6ad2]/30',
    shadow: 'shadow-[0_8px_32px_rgba(0,0,0,0.6)]',
    shadowLg: 'shadow-[0_16px_64px_rgba(0,0,0,0.8)]',
    gradient: 'from-[#5e6ad2] to-[#454eb8]',
    inputBg: 'bg-[#ffffff]/[0.02]',
    divider: 'border-white/[0.04]',
  },
  oled: {
    bg: 'bg-[#000000]',
    card: 'bg-black backdrop-blur-3xl shadow-[0_0_0_1px_rgba(255,255,255,0.06)]',
    cardSolid: 'bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.06)]',
    cardGlass: 'bg-black/20 backdrop-blur-3xl shadow-[0_0_0_1px_rgba(255,255,255,0.06)]',
    cardHover: 'hover:bg-[#0a0a0a] hover:shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_8px_24px_rgba(0,0,0,1)] hover:-translate-y-[1px]',
    surface: 'bg-[#050505]',
    border: 'border-white/[0.06]',
    text: 'text-white',
    subtext: 'text-[#666666]',
    headerBg: 'bg-black/90',
    accent: 'text-[#7d8cf7]',
    accentBg: 'bg-[#7d8cf7]',
    accentSoft: 'bg-[#7d8cf7]/10 text-[#7d8cf7]',
    ring: 'ring-[#7d8cf7]/20',
    shadow: 'shadow-[0_8px_32px_rgba(0,0,0,1)]',
    shadowLg: 'shadow-[0_16px_64px_rgba(0,0,0,1)]',
    gradient: 'from-[#7d8cf7] to-[#5e6ad2]',
    inputBg: 'bg-[#ffffff]/[0.03]',
    divider: 'border-white/[0.06]',
  },
  light: {
    bg: 'bg-[#ffffff]',
    card: 'bg-[#ffffff]/90 backdrop-blur-3xl shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_1px_3px_rgba(0,0,0,0.04)]',
    cardSolid: 'bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_1px_3px_rgba(0,0,0,0.04)]',
    cardGlass: 'bg-[#fcfcfc]/80 backdrop-blur-3xl shadow-[0_0_0_1px_rgba(0,0,0,0.05)]',
    cardHover: 'hover:bg-[#fafafa] hover:shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_4px_16px_rgba(0,0,0,0.06)] hover:-translate-y-[1px]',
    surface: 'bg-[#f4f4f5]',
    border: 'border-black/[0.05]',
    text: 'text-[#111111]',
    subtext: 'text-[#666666]',
    headerBg: 'bg-[#ffffff]/70',
    accent: 'text-[#434ce6]',
    accentBg: 'bg-[#434ce6]',
    accentSoft: 'bg-[#434ce6]/8 text-[#434ce6]',
    ring: 'ring-[#434ce6]/20',
    shadow: 'shadow-[0_8px_32px_rgba(0,0,0,0.04)]',
    shadowLg: 'shadow-[0_16px_64px_rgba(0,0,0,0.08)]',
    gradient: 'from-[#434ce6] to-[#343bbb]',
    inputBg: 'bg-black/[0.02]',
    divider: 'border-black/[0.05]',
  }
};

export type Theme = typeof themeColors['dark'];

export const fontSizes = {
  small: 'text-[14px]',
  normal: 'text-[15px]',
  large: 'text-[17px]'
};

export type FontSizeKey = keyof typeof fontSizes;

/* Semantic color tokens — Apple/Linear refined palette */
export const semanticColors = {
  correct: { bg: 'bg-[#34d399]/10', text: 'text-[#34d399]', border: 'border-[#34d399]/20', solid: 'bg-[#34d399]' },
  incorrect: { bg: 'bg-[#f87171]/10', text: 'text-[#f87171]', border: 'border-[#f87171]/20', solid: 'bg-[#f87171]' },
  warning: { bg: 'bg-[#fbbf24]/10', text: 'text-[#fbbf24]', border: 'border-[#fbbf24]/20', solid: 'bg-[#fbbf24]' },
  info: { bg: 'bg-[#38bdf8]/10', text: 'text-[#38bdf8]', border: 'border-[#38bdf8]/20', solid: 'bg-[#38bdf8]' },
  purple: { bg: 'bg-[#a78bfa]/10', text: 'text-[#a78bfa]', border: 'border-[#a78bfa]/20', solid: 'bg-[#a78bfa]' },
  gold: { bg: 'bg-[#fcd34d]/10', text: 'text-[#fcd34d]', border: 'border-[#fcd34d]/20', solid: 'bg-[#fcd34d]' },
};
