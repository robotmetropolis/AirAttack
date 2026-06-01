import { defineConfig } from "vite";

// El proxy /api/opensky va al backend Node si está corriendo en :8787 (modo
// LIVE con OAuth2 y 4000 créditos/día). En GitHub Pages no hay proxy posible
// porque es static-only, así que la app corre solo en modo SIM.

const useProxy = process.env.VITE_OPENSKY_USE_PROXY !== "false";

// Para GitHub Pages: la app vive en https://<user>.github.io/<repo>/
// Pasamos VITE_BASE_PATH=/repo-name/ desde el workflow al build.
// En dev queda en "/" así que no afecta `npm run dev`.
const base = process.env.VITE_BASE_PATH || "/";

export default defineConfig({
  base,
  server: {
    port: 5173,
    open: true,
    proxy: useProxy
      ? {
          "/api/opensky": {
            target: "http://localhost:8787",
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/opensky/, "/api"),
          },
        }
      : {
          "/api/opensky": {
            target: "https://opensky-network.org",
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/opensky/, "/api"),
          },
        },
  },
  build: {
    sourcemap: true,
  },
});
