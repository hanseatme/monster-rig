/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'panel': '#1e1e1e',
        'panel-light': '#252526',
        'panel-border': '#3c3c3c',
        'accent': '#007acc',
        'accent-hover': '#1e90ff',
        'bone-selected': '#ff8c00',
        'bone-default': '#ffffff',
        'keyframe': '#ffd700',
        'weight-low': '#0066ff',
        'weight-high': '#ff3300',
      },
    },
  },
  plugins: [],
}
