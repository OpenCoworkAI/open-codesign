/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    colors: {
      white: '#ffffff',
      black: '#000000',
    },
    extend: {
      colors: {
        brand: {
          primary: '#D97757',
          secondary: '#4A6FA5',
        },
        neutral: {
          100: '#f5f5f5',
          900: '#1a1a1a',
        },
      },
      fontSize: {
        sm: '0.875rem',
        base: '1rem',
        lg: '1.125rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '16px',
        full: '9999px',
      },
      spacing: {
        1: '0.25rem',
        2: '0.5rem',
        4: '1rem',
        8: '2rem',
      },
    },
  },
};
