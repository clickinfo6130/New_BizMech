/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // BizMech brand palette — deep navy + teal accent
        brand: {
          50:  '#eef4ff',
          100: '#d9e5ff',
          200: '#b8ceff',
          300: '#8aafff',
          400: '#5c86ff',
          500: '#3461f5',
          600: '#2146db',
          700: '#1b36b0',
          800: '#182f8c',
          900: '#172b6e',
          950: '#0f1a45',
        },
        accent: {
          50:  '#ecfeff',
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
          700: '#0e7490',
        },
        surface: {
          DEFAULT: '#ffffff',
          muted: '#f8fafc',
          elevated: '#ffffff',
          border: '#e2e8f0',
        },
      },
      fontFamily: {
        sans: [
          'Pretendard',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Noto Sans KR',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,0.06), 0 2px 12px rgba(15,23,42,0.04)',
        elevated: '0 4px 24px rgba(15,23,42,0.08)',
      },
      borderRadius: {
        xl: '0.9rem',
        '2xl': '1.1rem',
      },
    },
  },
  plugins: [],
};
