/** @type {import('tailwindcss').Config} */
//
// FlowMind — "Aurora" design system.
//
// Goal: a calm, futuristic operating-layer aesthetic. No neon, no hacker
// chrome. The accent gradient (violet → azure) is reserved for active state
// and the brand mark; everything else lives in graphite + glass borders.
//
export default {
  content: ['./index.html', './src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      letterSpacing: {
        display: '-0.015em',
        micro: '0.18em',
      },
      colors: {
        // Surfaces — graphite/obsidian. The panel is dark by design.
        ink: {
          0: '#06060C',
          50: '#08080F',
          100: '#0B0B14',
          200: '#0F0F1A',
          300: '#141422',
          400: '#1A1A2A',
          500: '#222236',
        },
        // Accent — calm violet/azure. Use sparingly.
        accent: {
          400: '#9C84FF',
          500: '#7C5CFF',
          600: '#5E3FE0',
          azure: '#4FA3FF',
        },
        // Status hues — desaturated, never electric.
        good: '#34D8B7',
        warn: '#FFB454',
        bad: '#FF6F91',
        // Foreground tiers.
        fg: {
          0: '#FFFFFF',
          50: '#E8E9F2',
          100: '#C3C5D6',
          200: '#9598AE',
          300: '#6B6E84',
          400: '#4A4D60',
          500: '#33354A',
        },
      },
      backgroundImage: {
        'aurora-accent': 'linear-gradient(135deg, #7C5CFF 0%, #4FA3FF 100%)',
        'aurora-soft':
          'linear-gradient(180deg, rgba(124,92,255,0.08) 0%, rgba(79,163,255,0.02) 100%)',
        'panel-grad': 'linear-gradient(180deg, #0F0F1A 0%, #08080F 100%)',
        'glass-line':
          'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.12) 50%, transparent 100%)',
      },
      boxShadow: {
        // One subtle elevation tier — no stacked shadows.
        panel: '0 24px 64px -24px rgba(0,0,0,0.6), 0 1px 0 0 rgba(255,255,255,0.04) inset',
        chip: '0 1px 0 0 rgba(255,255,255,0.04) inset',
        accent: '0 0 0 1px rgba(124,92,255,0.4), 0 8px 24px -8px rgba(124,92,255,0.4)',
      },
      borderRadius: {
        chip: '6px',
        ctrl: '10px',
        card: '14px',
        panel: '18px',
      },
      keyframes: {
        // Subtle, not theatrical.
        'fm-fade': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fm-lift': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fm-slide-right': {
          '0%': { opacity: '0', transform: 'translateX(12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'fm-sweep': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'fm-breathe': {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'fm-fade': 'fm-fade 200ms ease-out both',
        'fm-lift': 'fm-lift 220ms ease-out both',
        'fm-slide-right': 'fm-slide-right 240ms ease-out both',
        'fm-sweep': 'fm-sweep 1.6s ease-in-out infinite',
        'fm-breathe': 'fm-breathe 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
