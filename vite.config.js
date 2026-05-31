import { defineConfig } from "vite";
import cesium from "vite-plugin-cesium";

// El proxy /api/opensky va al backend Node si está corriendo en :8787,
// si no responde, falla con error y el frontend ya muestra "ERR" en API.
//
// Levantar el proxy:
//   cd server && npm install && npm start
// (Necesario para OAuth2 con tu cuenta OpenSky personal y 4000 créditos/día)
//
// Si NO levantás el proxy, podés cambiar VITE_OPENSKY_USE_PROXY a "false" en
// .env y la app caerá al modo anónimo via opensky-network.org directo
// (con limitaciones CORS y 400 créditos/día).

const useProxy = process.env.VITE_OPENSKY_USE_PROXY !== "false";

// Para GitHub Pages: la app vive en https://<user>.github.io/<repo>/
// Pasamos VITE_BASE_PATH=/repo-name/ desde el workflow al build.
// En dev queda en "/" así que no afecta `npm run dev`.
const base = process.env.VITE_BASE_PATH || "/";

// vite-plugin-cesium inyecta tags con paths absolutos `/cesium/...` que ignoran
// el `base` config. Este plugin auxiliar corre después y reescribe esos paths
// para que apunten a `${base}cesium/...`. Solo aplica si la base no es "/".
function fixCesiumBase(baseUrl) {
  return {
    name: "fix-cesium-base",
    enforce: "post",
    apply: "build",
    transformIndexHtml(html) {
      if (!baseUrl || baseUrl === "/") return html;
      return html
        .replace(/href="\/cesium\//g, `href="${baseUrl}cesium/`)
        .replace(/src="\/cesium\//g, `src="${baseUrl}cesium/`)
        .replace(
          /window\.CESIUM_BASE_URL\s*=\s*["']\/cesium\/?["']/g,
          `window.CESIUM_BASE_URL="${baseUrl}cesium/"`
        );
    },
  };
}

export default defineConfig({
  base,
  plugins: [cesium(), fixCesiumBase(base)],
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
    // Necesario para `await Cesium.createWorldTerrainAsync(...)` a nivel top.
    // Browsers modernos (Chrome 89+, FF 89+, Safari 15+) lo soportan sin issues.
    target: "esnext",
  },
});
