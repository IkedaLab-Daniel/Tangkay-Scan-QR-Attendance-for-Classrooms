const { fontFamily } = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // ── shadcn semantic tokens (HSL CSS vars) ────────────────────────────
      colors: {
        border:      'hsl(var(--border))',
        input:       'hsl(var(--input))',
        ring:        'hsl(var(--ring))',
        background:  'hsl(var(--background))',
        foreground:  'hsl(var(--foreground))',

        primary: {
          DEFAULT:    'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT:    'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT:    'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT:    'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT:    'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT:    'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        sidebar: {
          DEFAULT:             'hsl(var(--sidebar))',
          foreground:          'hsl(var(--sidebar-foreground))',
          primary:             'hsl(var(--sidebar-primary))',
          'primary-foreground':'hsl(var(--sidebar-primary-foreground))',
          accent:              'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border:              'hsl(var(--sidebar-border))',
          ring:                'hsl(var(--sidebar-ring))',
        },

        // ── MD3 extended tokens (rgb triples → Tailwind opacity modifier) ──
        'on-primary':               'rgb(var(--color-on-primary) / <alpha-value>)',
        'primary-container':        'rgb(var(--color-primary-container) / <alpha-value>)',
        'on-primary-container':     'rgb(var(--color-on-primary-container) / <alpha-value>)',
        'primary-fixed':            'rgb(var(--color-primary-fixed) / <alpha-value>)',
        'primary-fixed-dim':        'rgb(var(--color-primary-fixed-dim) / <alpha-value>)',
        'on-primary-fixed':         'rgb(var(--color-on-primary-fixed) / <alpha-value>)',
        'on-primary-fixed-variant': 'rgb(var(--color-on-primary-fixed-variant) / <alpha-value>)',

        'on-secondary':             'rgb(var(--color-on-secondary) / <alpha-value>)',
        'secondary-container':      'rgb(var(--color-secondary-container) / <alpha-value>)',
        'on-secondary-container':   'rgb(var(--color-on-secondary-container) / <alpha-value>)',
        'secondary-fixed':          'rgb(var(--color-secondary-fixed) / <alpha-value>)',
        'secondary-fixed-dim':      'rgb(var(--color-secondary-fixed-dim) / <alpha-value>)',
        'on-secondary-fixed':       'rgb(var(--color-on-secondary-fixed) / <alpha-value>)',

        tertiary:                   'rgb(var(--color-tertiary) / <alpha-value>)',
        'on-tertiary':              'rgb(var(--color-on-tertiary) / <alpha-value>)',
        'tertiary-container':       'rgb(var(--color-tertiary-container) / <alpha-value>)',
        'on-tertiary-container':    'rgb(var(--color-on-tertiary-container) / <alpha-value>)',
        'tertiary-fixed':           'rgb(var(--color-tertiary-fixed) / <alpha-value>)',
        'tertiary-fixed-dim':       'rgb(var(--color-tertiary-fixed-dim) / <alpha-value>)',
        'on-tertiary-fixed':        'rgb(var(--color-on-tertiary-fixed) / <alpha-value>)',

        surface:                    'rgb(var(--color-surface) / <alpha-value>)',
        'surface-dim':              'rgb(var(--color-surface-dim) / <alpha-value>)',
        'surface-bright':           'rgb(var(--color-surface-bright) / <alpha-value>)',
        'surface-container-lowest': 'rgb(var(--color-surface-container-lowest) / <alpha-value>)',
        'surface-container-low':    'rgb(var(--color-surface-container-low) / <alpha-value>)',
        'surface-container':        'rgb(var(--color-surface-container) / <alpha-value>)',
        'surface-container-high':   'rgb(var(--color-surface-container-high) / <alpha-value>)',
        'surface-container-highest':'rgb(var(--color-surface-container-highest) / <alpha-value>)',
        'on-surface':               'rgb(var(--color-on-surface) / <alpha-value>)',
        'on-surface-variant':       'rgb(var(--color-on-surface-variant) / <alpha-value>)',
        'inverse-surface':          'rgb(var(--color-inverse-surface) / <alpha-value>)',
        'inverse-on-surface':       'rgb(var(--color-inverse-on-surface) / <alpha-value>)',
        'inverse-primary':          'rgb(var(--color-inverse-primary) / <alpha-value>)',

        outline:                    'rgb(var(--color-outline) / <alpha-value>)',
        'outline-variant':          'rgb(var(--color-outline-variant) / <alpha-value>)',

        error:                      'rgb(var(--color-error) / <alpha-value>)',
        'on-error':                 'rgb(var(--color-on-error) / <alpha-value>)',
        'error-container':          'rgb(var(--color-error-container) / <alpha-value>)',
        'on-error-container':       'rgb(var(--color-on-error-container) / <alpha-value>)',

        'on-background':            'rgb(var(--color-on-background) / <alpha-value>)',
        'surface-variant':          'rgb(var(--color-surface-variant) / <alpha-value>)',
        'surface-tint':             'rgb(var(--color-surface-tint) / <alpha-value>)',
      },

      borderRadius: {
        lg:    'var(--radius)',
        md:    'calc(var(--radius) - 2px)',
        sm:    'calc(var(--radius) - 4px)',
        xl:    '1.5rem',
        '2xl': '1.75rem',
        '3xl': '2rem',
        full:  '9999px',
      },

      fontFamily: {
        sans:     ['DM Sans', ...fontFamily.sans],
        headline: ['Bricolage Grotesque', ...fontFamily.sans],
      },

      fontSize: {
        'headline-xl':        ['36px', { lineHeight: '44px', fontWeight: '700' }],
        'headline-xl-mobile': ['28px', { lineHeight: '36px', fontWeight: '700' }],
        'headline-lg':        ['24px', { lineHeight: '32px', fontWeight: '700' }],
        'headline-md':        ['20px', { lineHeight: '28px', fontWeight: '600' }],
        'headline-sm':        ['18px', { lineHeight: '24px', fontWeight: '600' }],
        'body-lg':            ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'body-md':            ['14px', { lineHeight: '20px', fontWeight: '400' }],
        'body-sm':            ['12px', { lineHeight: '16px', fontWeight: '400' }],
        'label-lg':           ['14px', { lineHeight: '20px', fontWeight: '600' }],
        'label-md':           ['12px', { lineHeight: '16px', fontWeight: '600' }],
        'label-sm':           ['11px', { lineHeight: '14px', fontWeight: '600' }],
      },

      spacing: {
        'space-xs': '0.25rem',
        'space-sm': '0.5rem',
        'space-md': '1rem',
        'space-lg': '1.25rem',
        'space-xl': '1.75rem',
        gutter:          '1rem',
        'gutter-mobile': '0.75rem',
        margin:          '1.25rem',
        'margin-mobile': '1rem',
      },

      boxShadow: {
        card:    '0 4px 16px rgba(43,42,38,0.05), 0 1px 2px rgba(43,42,38,0.03)',
        float:   '0 12px 32px rgba(43,42,38,0.08), 0 2px 6px rgba(43,42,38,0.04)',
        primary: '0 4px 12px rgba(18,106,58,0.22)',
      },

      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to:   { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to:   { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up':   'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
