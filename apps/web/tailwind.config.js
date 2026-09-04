/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /**
         * Apex primary — Sports Teal (#14697B) sits at 700, the lightest step
         * that clears AA both as text on white and as a background under white
         * (6.29:1). The ramp keeps its name `brand` so the existing brand-*
         * usages re-tint without a single JSX edit.
         */
        brand: {
          50: '#eef9fc',
          100: '#ddf4f8',
          200: '#bce7f0',
          300: '#8ed2e1',
          400: '#40b1c9',
          500: '#23899f',
          600: '#18778b',
          700: '#14697b',
          800: '#105261',
          900: '#0d3f4a',
          950: '#09282f',
        },
        /**
         * Apex accent — Peridot (#E0EA49) at 500.
         *
         * It is 1.31:1 on white, so it is a FILL and never text on a light
         * surface: use it behind ink-900 text, on the dark teal surfaces, or as
         * a meter bar. Only peridot-900 is legible as body text on white.
         */
        peridot: {
          50: '#fcfeec',
          100: '#fafcd9',
          200: '#f5f9b9',
          300: '#ecf38c',
          400: '#e6ee68',
          500: '#e0ea49',
          600: '#d1dc28',
          700: '#acb61b',
          800: '#899118',
          900: '#6e7416',
        },
        /**
         * Apex neutral — Black Steel (#0F172B) is one unit of blue away from
         * Tailwind's own slate-900 (#0f172a), so the Apex neutral IS slate.
         * `ink` is that scale under a semantic name, with 900 pinned to the
         * exact brand hex. Stock slate-* stays valid, which is why the ~300
         * existing slate usages need no migration.
         */
        ink: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172b',
          950: '#020617',
        },
        // Strong Amber (#F59E0B) is exactly Tailwind's amber-500 — use amber-*.
      },
      fontFamily: {
        // @fontsource-variable registers the family as "Inter Tight Variable".
        sans: [
          '"Inter Tight Variable"',
          '"Inter Tight"',
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { card: '1rem', panel: '1.25rem' },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 43 / 0.04), 0 8px 24px -12px rgb(15 23 43 / 0.10)',
        raised: '0 4px 6px -2px rgb(15 23 43 / 0.05), 0 16px 32px -12px rgb(15 23 43 / 0.16)',
        hero: '0 20px 40px -20px rgb(16 82 97 / 0.55)',
      },
    },
  },
  plugins: [],
};
