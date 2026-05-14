/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        cyber: {
          bg: '#070712',
          panel: '#0d0d22',
          panel2: '#11122a',
          border: '#1f2155',
          neon: '#00f0ff',
          pink: '#ff2bd6',
          purple: '#a855f7',
          yellow: '#f6ff00',
          text: '#d6e1ff',
          mute: '#7a83b6',
        },
      },
      fontFamily: {
        display: ['Orbitron', 'system-ui', 'sans-serif'],
        body: ['Rajdhani', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        neon: '0 0 12px rgba(0,240,255,0.45), 0 0 28px rgba(0,240,255,0.15)',
        pink: '0 0 12px rgba(255,43,214,0.5), 0 0 28px rgba(255,43,214,0.2)',
      },
      animation: {
        glow: 'glow 2.4s ease-in-out infinite',
      },
      keyframes: {
        glow: {
          '0%,100%': { opacity: '0.7' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
