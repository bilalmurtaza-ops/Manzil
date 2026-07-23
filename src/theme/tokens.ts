/**
 * Manzil design tokens — "Ink & Ivory" with Pakistan-green accent.
 * Warm paper surfaces, deep ink text, restrained green as the single accent.
 */

export const color = {
  // Surfaces
  paper: '#FAF7F0', // app background — warm ivory
  card: '#FFFFFF',
  cardWarm: '#F4EFE4', // slightly sunken warm panel
  inkWash: '#0E1B12', // deep green-black, dark surfaces (headers, splash)

  // Ink (text)
  ink: '#171D17',
  inkSoft: '#4A524A',
  inkFaint: '#8A9088',

  // Accent — Pakistan green family
  green: '#14532D', // primary actions, active states
  greenDeep: '#0B3B1F',
  greenSoft: '#E4EFE4', // tinted fills
  greenMid: '#2E7D4F',

  // Signals
  gold: '#C9972E', // streaks, celebration
  goldSoft: '#F7EDD8',
  rust: '#B4552D', // risk / overdue
  rustSoft: '#F6E5DC',

  // Lines
  line: '#E7E1D3', // hairline borders on paper
  lineStrong: '#D6CFBE',

  // On-dark
  paperOnDark: '#F2EEE3',
  fadedOnDark: 'rgba(242, 238, 227, 0.64)',
} as const;

/** Per-subject identity colors — muted, print-like, never neon. */
export const subjectColor: Record<string, { main: string; soft: string }> = {
  math: { main: '#31547A', soft: '#E3EAF2' },
  physics: { main: '#6B4F8C', soft: '#ECE6F3' },
  chemistry: { main: '#9A5B23', soft: '#F4E9DC' },
  biology: { main: '#2E7D4F', soft: '#E4EFE4' },
  computer: { main: '#3A6B6B', soft: '#E2EEEE' },
  english: { main: '#7A3B4F', soft: '#F2E3E8' },
  urdu: { main: '#14532D', soft: '#E4EFE4' },
  islamiat: { main: '#82661F', soft: '#F2ECD8' },
  pakstudies: { main: '#54622F', soft: '#EAEEDD' },
  general: { main: '#4A524A', soft: '#EBE9E1' },
};

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  full: 999,
} as const;

export const font = {
  /** UI grotesk */
  regular: 'SpaceGrotesk_400Regular',
  medium: 'SpaceGrotesk_500Medium',
  semibold: 'SpaceGrotesk_600SemiBold',
  bold: 'SpaceGrotesk_700Bold',
  /** Urdu display accent */
  urdu: 'NotoNastaliqUrdu_400Regular',
  urduBold: 'NotoNastaliqUrdu_700Bold',
} as const;

export const type = {
  display: { fontFamily: font.bold, fontSize: 32, lineHeight: 38, letterSpacing: -0.5 },
  title: { fontFamily: font.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.3 },
  heading: { fontFamily: font.semibold, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22 },
  bodyMedium: { fontFamily: font.medium, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: font.regular, fontSize: 13, lineHeight: 18 },
  smallMedium: { fontFamily: font.medium, fontSize: 13, lineHeight: 18 },
  micro: { fontFamily: font.medium, fontSize: 11, lineHeight: 14, letterSpacing: 0.6 },
} as const;

/** Consistent hairline card style on paper background. */
export const cardShadow = {
  shadowColor: '#3C3325',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 8,
  elevation: 2,
} as const;
