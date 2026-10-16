module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: { extend: {
    colors: { clay: { DEFAULT: 'var(--accent)', hover: 'var(--accent-hover)' } },
    transitionDuration: { fast: '160ms' },
    boxShadow: { field: 'inset 0 0 0 1px var(--line)', '2xs': '0 1px 2px rgb(0 0 0 / 0.04)' }
  } },
  plugins: []
};
