/** @type {import('tailwindcss').Config} */
import colors from 'tailwindcss/colors';

export default {
  content: [
    "./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Softer, more "pastel" accent palette for consistent branding.
        // (Keep Tailwind defaults for pink/rose/blue; add a dedicated brand scale.)
        brand: colors.sky,
      },
      gridTemplateColumns: {
        // Custom grid columns para mejor visualización de números
        '15': 'repeat(15, minmax(0, 1fr))',
        '20': 'repeat(20, minmax(0, 1fr))',
      },
    },
  },
  plugins: [],
};
