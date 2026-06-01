import { defineConfig } from "vite";
import cesium from "vite-plugin-cesium";
import fs from "node:fs";
import path from "node:path";

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

/**
 * vite-plugin-cesium tiene un bug cuando hay `base` distinto de "/":
 * en su closeBundle hace `path.join(outDir, base + "cesium/", "Assets")`
 * que termina copiando los archivos a `dist/<base>/cesium/...` (ej.
 * `dist/AirAttack/cesium/...`). Pero los <link> y <script> del HTML
 * referencian `/<base>/cesium/...` que en GitHub Pages se resuelve a
 * `dist/cesium/...`. Resultado: 404.
 *
 * Este plugin auxiliar copia los archivos de Cesium al lugar correcto
 * (`<outDir>/cesium/...`) en el closeBundle, después del plugin oficial.
 */
function fixCesiumAssets() {
  let outDir = "dist";
  return {
    name: "fix-cesium-assets",
    enforce: "post",
    apply: "build",
    configResolved(config) {
      outDir = config.build?.outDir || "dist";
    },
    closeBundle() {
      const cesiumSrc = path.resolve("node_modules/cesium/Build/Cesium");
      const dest = path.resolve(outDir, "cesium");
      const dirs = ["Assets", "ThirdParty", "Workers", "Widgets"];
      try {
        fs.mkdirSync(dest, { recursive: true });
        for (const d of dirs) {
          const src = path.join(cesiumSrc, d);
          if (fs.existsSync(src)) {
            fs.cpSync(src, path.join(dest, d), { recursive: true, force: true });
          }
        }
        const cesiumJs = path.join(cesiumSrc, "Cesium.js");
        if (fs.existsSync(cesiumJs)) {
          fs.cpSync(cesiumJs, path.join(dest, "Cesium.js"), { force: true });
        }
        console.log(`[fix-cesium-assets] copied cesium assets to ${dest}`);
      } catch (err) {
        console.error("[fix-cesium-assets] copy failed", err);
        throw err;
      }
    },
  };
}

export default defineConfig({
  base,
  plugins: [cesium(), fixCesiumAssets()],
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
