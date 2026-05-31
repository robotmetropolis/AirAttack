// Proxy server para OpenSky:
// - Maneja OAuth2 client_credentials con OpenSky (token + refresh)
// - Reenvía /api/states/all con el header Authorization Bearer
// - Devuelve el header X-Rate-Limit-Remaining para el frontend
// - Habilita CORS abierto para localhost
//
// Uso:
//   cd radar-atc-3d/server
//   npm install
//   OPENSKY_CLIENT_ID=tu-id OPENSKY_CLIENT_SECRET=tu-secret npm start
//
// O bien con archivo .env (ver .env.example).

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Cargar .env si existe ────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

const URL_TOKEN =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const URL_API = "https://opensky-network.org/api";

const CLIENT_ID = process.env.OPENSKY_CLIENT_ID || "";
const CLIENT_SECRET = process.env.OPENSKY_CLIENT_SECRET || "";

const PORT = process.env.PORT || 8787;

const useAuth = !!(CLIENT_ID && CLIENT_SECRET);
if (!useAuth) {
  console.warn(
    "[proxy] OPENSKY_CLIENT_ID/SECRET no configurados. " +
      "Funcionará en modo anónimo (400 créditos/día).",
  );
} else {
  console.log("[proxy] OAuth2 habilitado con client", CLIENT_ID);
}

// ── Token cache ──────────────────────────────────────────────────────────────
let tokenCache = {
  access_token: null,
  expires_at: 0, // epoch ms
};

async function getToken() {
  if (!useAuth) return null;
  if (tokenCache.access_token && Date.now() < tokenCache.expires_at - 30_000) {
    return tokenCache.access_token;
  }
  console.log("[proxy] solicitando nuevo token OAuth2…");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  const r = await fetch(URL_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Token fail HTTP ${r.status}: ${text.substring(0, 200)}`);
  }
  const json = await r.json();
  tokenCache.access_token = json.access_token;
  tokenCache.expires_at = Date.now() + (json.expires_in ?? 1800) * 1000;
  console.log(
    `[proxy] token OK (vigencia ${json.expires_in}s)`,
  );
  return tokenCache.access_token;
}

// ── App Express ──────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: true }));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    auth_configured: useAuth,
    has_token: !!tokenCache.access_token,
    token_expires_in_s: tokenCache.access_token
      ? Math.round((tokenCache.expires_at - Date.now()) / 1000)
      : 0,
  });
});

// Reenvío genérico GET /api/* hacia OpenSky
app.get("/api/*", async (req, res) => {
  try {
    const subPath = req.path.replace(/^\/api/, "");
    const url = `${URL_API}${subPath}${
      req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : ""
    }`;
    const headers = { Accept: "application/json" };
    if (useAuth) {
      const token = await getToken();
      headers.Authorization = `Bearer ${token}`;
    }
    const upstream = await fetch(url, { headers });
    // Reenviar headers relevantes
    const credits = upstream.headers.get("X-Rate-Limit-Remaining");
    const retryAfter = upstream.headers.get("X-Rate-Limit-Retry-After-Seconds");
    if (credits) res.setHeader("X-Rate-Limit-Remaining", credits);
    if (retryAfter)
      res.setHeader("X-Rate-Limit-Retry-After-Seconds", retryAfter);
    res.status(upstream.status);
    const text = await upstream.text();
    res.setHeader("Content-Type", upstream.headers.get("Content-Type") || "application/json");
    res.send(text);
  } catch (err) {
    console.error("[proxy] error", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(
    `[proxy] escuchando en http://localhost:${PORT} (auth=${useAuth ? "OAuth2" : "anónimo"})`,
  );
});
