/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        surface: 'hsl(var(--surface))',
        'surface-raised': 'hsl(var(--panel))',
        'surface-elevated': 'hsl(var(--accent))',
        'surface-hover': 'hsl(var(--accent))',
        panel: 'hsl(var(--panel))',
        ring: 'hsl(var(--ring))',
        destructive: 'hsl(var(--destructive))',
        border: 'hsl(var(--border))',
        'border-subtle': 'hsl(var(--sidebar-border))',
        'border-focus': 'hsl(var(--ring))',
        muted: 'hsl(var(--muted-foreground))',
        'muted-foreground': 'hsl(var(--muted-foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        signal: {
          DEFAULT: 'hsl(var(--signal))',
          foreground: 'hsl(var(--signal-foreground))',
        },
        warn: 'hsl(var(--warn))',
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          primary: 'hsl(var(--sidebar-primary))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        glow: '0 0 20px -5px hsl(var(--primary) / 0.35)',
        'amber-glow': '0 0 20px -5px hsl(var(--warn) / 0.3)',
        'emerald-glow': '0 0 20px -5px hsl(var(--signal) / 0.3)',
      },
      fontFamily: {
        mono: ['IBM Plex Mono', 'JetBrains Mono', 'Menlo', 'Monaco', 'Courier New', 'monospace'],
        sans: ['Space Grotesk', 'IBM Plex Sans', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.28s cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
