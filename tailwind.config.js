/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#05080f', 900: '#0a1020', 800: '#0f172a', 700: '#16213a', 600: '#1e2b4a' },
        pitch: { DEFAULT: '#0b3d2a', light: '#0f5237' },
      },
      fontFamily: { display: ['"Barlow Condensed"', 'ui-sans-serif', 'system-ui'], sans: ['Inter', 'ui-sans-serif', 'system-ui'] },
    },
  },
  plugins: [],
};
