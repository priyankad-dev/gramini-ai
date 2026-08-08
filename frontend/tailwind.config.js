/** @type {import('tailwindcss').Config} */

/**
 * Every colour is a CSS variable, defined twice in index.css - once for light,
 * once for dark. Components never name a theme, so there is exactly one set of
 * classes to maintain and no way for the two themes to drift apart.
 *
 * Contrast ratios are recorded next to each pair in index.css and were checked
 * against WCAG AA (4.5:1 for body text, 3:1 for large text and UI borders).
 * Flat opaque surfaces throughout - no translucency, so a ratio measured once
 * stays true whatever sits behind the element.
 */
const token = (name) => `rgb(var(${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Surfaces, back to front.
        surface: token('--c-surface'),
        raised: token('--c-raised'),
        sunken: token('--c-sunken'),
        hover: token('--c-hover'),
        line: token('--c-line'),

        // Text, in descending emphasis.
        ink: token('--c-ink'),
        muted: token('--c-muted'),
        faint: token('--c-faint'),

        // Brand. Saffron leads, green supports - the two colours of the flag,
        // which is instantly legible as "official" to the users this is for.
        saffron: {
          soft: token('--c-saffron-soft'),
          DEFAULT: token('--c-saffron'),
          strong: token('--c-saffron-strong'),
          ink: token('--c-saffron-ink'),
        },
        leaf: {
          soft: token('--c-leaf-soft'),
          DEFAULT: token('--c-leaf'),
          strong: token('--c-leaf-strong'),
          ink: token('--c-leaf-ink'),
        },

        // Category accents, kept from the previous palette so scheme cards
        // stay recognisable.
        farming: token('--c-farming'),
        health: token('--c-health'),
        weather: token('--c-weather'),
        rights: token('--c-rights'),

        // Status.
        ok: token('--c-ok'),
        warn: token('--c-warn'),
        danger: token('--c-danger'),
        onbrand: token('--c-onbrand'),
      },
      fontFamily: {
        sans: [
          'Mukta',
          'Noto Sans Devanagari',
          'Segoe UI',
          'system-ui',
          'sans-serif',
        ],
      },
      fontSize: {
        // Base is 17px. The large-text toggle scales the root to 118%, taking
        // body to ~20px and every tap target with it, because everything below
        // is sized in rem.
        xs: ['0.8125rem', { lineHeight: '1.25rem' }],
        sm: ['0.9375rem', { lineHeight: '1.5rem' }],
        base: ['1.0625rem', { lineHeight: '1.75rem' }],
        lg: ['1.1875rem', { lineHeight: '1.9rem' }],
        xl: ['1.375rem', { lineHeight: '1.9rem' }],
        '2xl': ['1.75rem', { lineHeight: '2.25rem' }],
        '3xl': ['2.25rem', { lineHeight: '2.6rem' }],
        '4xl': ['3rem', { lineHeight: '3.2rem' }],
      },
      maxWidth: {
        thread: '48rem',
      },
      minHeight: {
        tap: '3rem',      // 48px -> 57px in large-text mode
        card: '6.5rem',
      },
      minWidth: {
        tap: '3rem',
      },
      borderRadius: {
        composer: '1.75rem',
        card: '1.25rem',
        xl2: '1.5rem',
      },
      boxShadow: {
        // Soft, low-contrast lifts. Deliberately gentle: a heavy drop shadow
        // reads as "floating" and confuses users who are new to touchscreens.
        card: '0 1px 2px rgb(0 0 0 / 0.06), 0 4px 12px rgb(0 0 0 / 0.06)',
        lift: '0 2px 4px rgb(0 0 0 / 0.08), 0 12px 28px rgb(0 0 0 / 0.10)',
        orb: '0 8px 32px rgb(var(--c-saffron) / 0.45)',
      },
      animation: {
        'orb-pulse': 'orb-pulse 2.4s ease-in-out infinite',
        'orb-ring': 'orb-ring 2s ease-out infinite',
        rise: 'rise 0.28s ease-out both',
        'bar': 'bar 0.9s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
