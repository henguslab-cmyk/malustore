/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      fontFamily: {
        serifDisplay: ['"Times New Roman"', 'Times', 'serif']
      },
      colors: {
        sand: '#f3f0ea',
        ink: '#111111'
      },
      boxShadow: {
        soft: '0 8px 24px rgba(0, 0, 0, 0.08)'
      }
    }
  },
  plugins: []
};
