/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          blue: 'var(--color-blue)',     
          red: 'var(--color-red)',      
          yellow: 'var(--color-yellow)',  
          black: 'var(--color-black)',   
          white: 'var(--color-white)',  
          bg: 'var(--color-bg)',
          surface: 'var(--color-surface)',
          text: 'var(--color-text)',
          shadow: 'var(--color-shadow)'
        }
      },
      boxShadow: {
        'brutal-sm': 'var(--shadow-offset) var(--shadow-offset) var(--shadow-blur) var(--shadow-spread) var(--color-shadow)',
        'brutal': 'var(--shadow-offset) var(--shadow-offset) var(--shadow-blur) var(--shadow-spread) var(--color-shadow)',
        'brutal-lg': 'calc(var(--shadow-offset) * 2) calc(var(--shadow-offset) * 2) var(--shadow-blur) var(--shadow-spread) var(--color-shadow)',
        'brutal-inverse': 'calc(var(--shadow-offset) * -1) var(--shadow-offset) var(--shadow-blur) var(--shadow-spread) var(--color-shadow)',
        '3d': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        '3d-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        'inner': 'inset var(--shadow-offset) var(--shadow-offset) var(--shadow-blur) var(--shadow-spread) rgba(0, 0, 0, 0.1)',
      },
      fontFamily: {
        sans: ['var(--font-primary)', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'brutal': 'var(--radius)',
      },
      transitionProperty: {
        'shadow': 'box-shadow, transform',
      }
    },
  },
  plugins: [],
}
