/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Earth tones - unified across modes
        forest: {
          50: '#f0f5f1',
          100: '#dce8de',
          200: '#b9d1be',
          300: '#8fb598',
          400: '#6a9a76',
          500: '#4A8B5C', // dark mode accent
          600: '#2D5A3D', // light mode accent
          700: '#244831',
          800: '#1c3826',
          900: '#15291c',
        },
        gold: {
          50: '#fdf8eb',
          100: '#f9eece',
          200: '#f2dca0',
          300: '#e9c46a',
          400: '#D4A84B', // dark mode secondary
          500: '#B8860B', // light mode secondary
          600: '#9a6f09',
          700: '#7c5907',
          800: '#614506',
          900: '#4a3405',
        },
        stone: {
          50: '#FAFAF8',
          100: '#F2F1ED',
          200: '#E5E4E0',
          300: '#D4D3CF',
          400: '#A8A8A4',
          500: '#9C9C96',
          600: '#6C6C68',
          700: '#5C5C58',
          800: '#2A2A28',
          900: '#1A1A18',
          950: '#121210',
        },
      },
      fontFamily: {
        display: ['Newsreader', 'Georgia', 'serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '10px',
        md: '10px',
        lg: '14px',
        xl: '18px',
      },
      boxShadow: {
        sm: '0 1px 3px rgba(28, 28, 26, 0.06)',
        DEFAULT: '0 2px 6px rgba(28, 28, 26, 0.08)',
        md: '0 4px 12px rgba(28, 28, 26, 0.08)',
        lg: '0 8px 24px rgba(28, 28, 26, 0.1)',
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'fade-in-up': 'fade-in-up 300ms ease-out',
        'roots-sway': 'roots-sway 20s ease-in-out infinite',
        'roots-sway-delayed': 'roots-sway-delayed 25s ease-in-out infinite',
        'shimmer': 'shimmer 4s linear infinite',
        'glow-line': 'glow-line 3s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
        'count-up': 'count-up 0.6s ease-out forwards',
        'pulse-subtle': 'pulse-subtle 2s ease-in-out infinite',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'roots-sway': {
          '0%, 100%': { transform: 'scaleY(-1) translateX(0)' },
          '50%': { transform: 'scaleY(-1) translateX(-1%)' },
        },
        'roots-sway-delayed': {
          '0%, 100%': { transform: 'scaleY(-1) translateX(10%)' },
          '50%': { transform: 'scaleY(-1) translateX(11%)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'glow-line': {
          '0%': { opacity: '0', transform: 'translateX(-100%)' },
          '50%': { opacity: '1' },
          '100%': { opacity: '0', transform: 'translateX(100%)' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'count-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-subtle': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
      },
      transitionDuration: {
        DEFAULT: '200ms',
        fast: '150ms',
        slow: '300ms',
      },
    },
  },
  plugins: [],
};
