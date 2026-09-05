/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#09090b',
        surface: '#18181b',
        'surface-raised': '#202024',
        'surface-elevated': '#27272a',
        'surface-hover': '#2e2e33',
        border: '#27272a',
        'border-subtle': '#1f1f23',
        'border-focus': '#3f3f46',
        muted: '#71717a',
        'muted-foreground': '#a1a1aa',
      },
      boxShadow: {
        glow: '0 0 20px -5px rgba(56, 189, 248, 0.25)',
        'amber-glow': '0 0 20px -5px rgba(245, 158, 11, 0.25)',
        'emerald-glow': '0 0 20px -5px rgba(16, 185, 129, 0.25)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Menlo', 'Monaco', 'Courier New', 'monospace'],
        sans: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
