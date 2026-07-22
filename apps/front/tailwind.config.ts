import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/app/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-app, "Inter")', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['var(--font-app-mono, "JetBrains Mono")', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      colors: {
        // We.Publish-Designsystem (styles.css v0.2): die im Code verwendeten
        // Tailwind-Paletten werden auf die Marken-Rampen umgelegt —
        // indigo -> Koralle (Akzent), slate -> Aubergine-Neutraltöne (Ink).
        indigo: {
          50: '#FDE8E6',
          100: '#FBD6D3',
          200: '#F8B6B3',
          300: '#F48A85',
          400: '#F0716A',
          500: '#EB5851',
          600: '#E0443D',
          700: '#C8362F',
          800: '#A52A24',
          900: '#7F1F1B',
          950: '#4A100D',
        },
        slate: {
          50: '#FAFAF7',
          100: '#ECE2E7',
          200: '#D6C8CF',
          300: '#B6A3AD',
          400: '#9B8290',
          500: '#846077',
          600: '#6B4159',
          700: '#5B2342',
          800: '#3A1226',
          900: '#210115',
          950: '#160010',
        },
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
        },
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [animate],
}

export default config
