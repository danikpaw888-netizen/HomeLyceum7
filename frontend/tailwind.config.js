/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#d9e6ff",
          500: "#3b6fe0",
          600: "#2f5bc4",
          700: "#28489e",
        },
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: 0 },
          "100%": { opacity: 1 },
        },
        fadeInUp: {
          "0%": { opacity: 0, transform: "translateY(12px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
        scaleIn: {
          "0%": { opacity: 0, transform: "scale(0.96)" },
          "100%": { opacity: 1, transform: "scale(1)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
      },
      animation: {
        "fade-in": "fadeIn 0.4s ease-out both",
        "fade-in-up": "fadeInUp 0.45s ease-out both",
        "scale-in": "scaleIn 0.3s ease-out both",
        shimmer: "shimmer 1.6s infinite linear",
      },
      boxShadow: {
        card: "0 1px 3px rgba(15, 23, 42, 0.06), 0 8px 24px -8px rgba(15, 23, 42, 0.08)",
        "card-hover": "0 4px 12px rgba(15, 23, 42, 0.08), 0 16px 32px -12px rgba(59, 111, 224, 0.18)",
      },
    },
  },
  plugins: [],
}
