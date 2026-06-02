// Renderer de amenazas para globe.gl.
//
// Cada amenaza activa se ve con TRES capas combinadas:
//
// 1. Columna vertical (pointsData)   → cilindro alto con color de categoría
// 2. Anillos pulsantes (ringsData)    → propagación animada con radio máx
//                                       proporcional al radio de la amenaza
// 3. HTML element (htmlElementsData)  → emoji + nombre flotando arriba
//
// Esto da un look "señal paranormal" sin necesidad de meshes complejos
// de Three.js, usando solo las primitivas que globe.gl ya optimiza.

import { THREATS } from "./threats.js";
import { mountThreatImage, getThreatImageColor } from "./threatImage.js";

const COLOR_BY_CATEGORY = {
  ufo: "#00ffff",
  paranormal: "#ff00aa",
  creature: "#ff5500",
};

// ── Color dominante del emoji ────────────────────────────────────────────────
// Renderiza el emoji a un canvas offscreen, lee los pixels y devuelve el color
// con más presencia (saltando transparentes, casi-blancos/negros y grises
// poco saturados que suelen ser bordes). Cacheado para no recalcular.

const _emojiColorCache = new Map();

function quantize(v) {
  return (v >> 5) << 5; // agrupa en buckets de 32
}

export function dominantColorFromEmoji(emoji, fallback = "#888888") {
  if (!emoji) return fallback;
  if (_emojiColorCache.has(emoji)) return _emojiColorCache.get(emoji);

  try {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.font =
      `${Math.floor(size * 0.85)}px 'Segoe UI Emoji', 'Apple Color Emoji', ` +
      "'Noto Color Emoji', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emoji, size / 2, size / 2);

    const data = ctx.getImageData(0, 0, size, size).data;
    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 120) continue; // saltamos transparente
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max < 35) continue; // casi negro (borde)
      if (min > 225) continue; // casi blanco (highlight)
      if (max - min < 22) continue; // gris poco saturado
      const key = `${quantize(r)},${quantize(g)},${quantize(b)}`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }

    let topKey = null;
    let topCount = 0;
    for (const [key, count] of buckets.entries()) {
      if (count > topCount) {
        topCount = count;
        topKey = key;
      }
    }
    if (!topKey) {
      _emojiColorCache.set(emoji, fallback);
      return fallback;
    }
    const [r, g, b] = topKey.split(",").map(Number);
    // Pequeño boost para que el color quede vibrante en el globo dark
    const boost = (v) => Math.min(255, Math.round(v * 1.18 + 12));
    const hex =
      "#" +
      [boost(r), boost(g), boost(b)]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
    _emojiColorCache.set(emoji, hex);
    return hex;
  } catch (err) {
    console.warn("[dominantColorFromEmoji] failed", err);
    return fallback;
  }
}

/**
 * Color unificado para pilar, anillos, halo e icono.
 * Prioridad: imagen wireframe → color del catálogo → emoji → categoría.
 */
export function colorForThreat(t, threatId = null) {
  if (!t) return "#888888";
  const id = threatId != null ? String(threatId) : null;
  const fromImage = id ? getThreatImageColor(id) : null;
  if (fromImage) return fromImage;
  if (t.color) return t.color;
  return dominantColorFromEmoji(
    t.icon,
    COLOR_BY_CATEGORY[t.category] || "#888888",
  );
}

const CAPTURE_RED = "#ff2244";

function parseHex(hex) {
  const m = String(hex).match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return null;
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

function blendHex(hexA, hexB, t) {
  const a = parseHex(hexA);
  const b = parseHex(hexB);
  if (!a || !b) return hexB;
  const mix = (x, y) => Math.round(x * (1 - t) + y * t);
  const r = mix(a.r, b.r);
  const g = mix(a.g, b.g);
  const bl = mix(a.b, b.b);
  return `#${[r, g, bl].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Radio del pilar en grados, acorde al radio de acción de la amenaza. */
function pillarRadiusForThreat(t, captureBoost = 1) {
  const radiusKm = t.radius_km || 200;
  const base = 0.2 + Math.sqrt(radiusKm / 250) * 0.32;
  return base * captureBoost;
}

/**
 * Manager de visualización de amenazas. Solo maneja el estado de qué
 * amenazas están "encendidas" en el globo. La lógica de juego (ataque,
 * timer, score) vive en threatManager.js.
 *
 * API:
 * - showThreat(id)      enciende la amenaza en el globo
 * - hideThreat(id)      la apaga
 * - clearAll()          apaga todas
 * - getPointsData()     array para globe.pointsData(...)
 * - getRingsData()      array para globe.ringsData(...)
 * - getHtmlElementsData() array para globe.htmlElementsData(...)
 * - getElementBuilder() builder para globe.htmlElement(...)
 */
export class ThreatRenderer {
  constructor() {
    this.activeIds = new Set();
    this._domCache = new Map();
    this.onClick = null;
  }

  showThreat(id) {
    if (THREATS[id]) this.activeIds.add(id);
  }
  hideThreat(id) {
    this.activeIds.delete(id);
    const dom = this._domCache.get(id);
    if (dom) dom.remove();
    this._domCache.delete(id);
  }
  clearAll() {
    this.activeIds.clear();
    for (const div of this._domCache.values()) div.remove();
    this._domCache.clear();
  }
  isActive(id) {
    return this.activeIds.has(id);
  }

  // ─── Capa 1: columna vertical (pointsData) ────────────────────────────
  getPointsData(captureCounts = null) {
    const captures =
      captureCounts instanceof Map ? captureCounts : new Map();
    const out = [];
    for (const id of this.activeIds) {
      const t = THREATS[id];
      if (!t) continue;
      const n = captures.get(id) || 0;
      const isCapturing = n > 0;
      const threatColor = colorForThreat(t, id);
      const color = isCapturing
        ? blendHex(threatColor, CAPTURE_RED, 0.62)
        : threatColor;
      const captureScale = isCapturing ? 1 + Math.min(n, 3) * 0.12 : 1;
      // Altura fija por poder (no sube/baja al capturar ni con el zoom).
      const altitude = 0.04 + (t.power || 3) * 0.04;
      out.push({
        threatId: id,
        lat: t.lat,
        lng: t.lon,
        altitude,
        radius: pillarRadiusForThreat(t, isCapturing ? 1.4 * captureScale : 1),
        color,
        isCapturing,
        label: t.name,
      });
    }
    return out;
  }

  // ─── Capa 2: anillos pulsantes (ringsData) ────────────────────────────
  getRingsData(captureCounts = null) {
    const captures =
      captureCounts instanceof Map ? captureCounts : new Map();
    const out = [];
    for (const id of this.activeIds) {
      const t = THREATS[id];
      if (!t) continue;
      const n = captures.get(id) || 0;
      const isCapturing = n > 0;
      const threatColor = colorForThreat(t, id);
      const color = isCapturing
        ? blendHex(threatColor, CAPTURE_RED, 0.5)
        : threatColor;
      out.push({
        threatId: id,
        lat: t.lat,
        lng: t.lon,
        maxR: Math.min(t.radius_km / 111, 12) * (isCapturing ? 1.08 : 1),
        propagationSpeed: isCapturing
          ? Math.max(1.2, (t.power || 3) * 0.45)
          : Math.max(0.5, (t.power || 3) * 0.3),
        repeatPeriod: isCapturing ? 900 : 1500,
        color,
        isCapturing,
      });
    }
    return out;
  }

  // ─── Capa 3: HTML elements (emoji + nombre) ───────────────────────────
  getHtmlElementsData(captureCounts = null) {
    const captures =
      captureCounts instanceof Map ? captureCounts : new Map();
    const out = [];
    for (const id of this.activeIds) {
      const t = THREATS[id];
      if (!t) continue;
      const n = captures.get(id) || 0;
      const isCapturing = n > 0;
      const threatColor = colorForThreat(t, id);
      const color = isCapturing
        ? blendHex(threatColor, CAPTURE_RED, 0.35)
        : threatColor;
      const altitude = 0.04 + (t.power || 3) * 0.04 + 0.03;
      out.push({
        threatId: id,
        lat: t.lat,
        lng: t.lon,
        alt: altitude,
        threat: t,
        color,
        isCapturing,
        captureCount: n,
      });
    }
    return out;
  }

  getElementBuilder() {
    return (d) => {
      let div = this._domCache.get(d.threatId);
      if (!div) {
        div = document.createElement("div");
        div.className = "threat-marker";
        div.style.pointerEvents = "none";
        div.style.cursor = "pointer";

        const halo = document.createElement("div");
        halo.className = "threat-halo";
        div.appendChild(halo);

        const icon = document.createElement("div");
        icon.className = "threat-icon";
        icon.dataset.role = "icon";
        div.appendChild(icon);

        const label = document.createElement("div");
        label.className = "threat-label";
        label.dataset.role = "label";
        div.appendChild(label);

        div.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.onClick?.(d.threatId);
        });

        this._domCache.set(d.threatId, div);
      }
      const t = d.threat;
      div.style.setProperty("--threat-color", d.color);
      // Multiplicador de tamaño según el radio de acción de la amenaza.
      // Sirve para que un Bermuda/Cthulhu (radio 800-1000 km) se vea bien
      // grande, y un Skinwalker/Nessie (radio 60-90 km) se vea chico.
      // Curva sqrt para que la diferencia no sea excesiva.
      const radius = t.radius_km || 200;
      const sizeMult = Math.max(0.55, Math.min(2.4, Math.sqrt(radius / 250)));
      div.style.setProperty("--threat-size-mult", sizeMult.toFixed(2));
      const captureN = d.captureCount || 0;
      const isCapturing = !!d.isCapturing;
      div.classList.toggle("capturing", isCapturing);
      div.style.setProperty(
        "--threat-capture-scale",
        isCapturing ? (1.22 + Math.min(captureN, 3) * 0.08).toFixed(2) : "1"
      );
      if (isCapturing) {
        div.style.setProperty("--threat-color", d.color);
      }
      const iconEl = div.querySelector('[data-role="icon"]');
      if (
        !iconEl.classList.contains("has-image") &&
        iconEl.dataset.imageLoading !== "1"
      ) {
        iconEl.textContent = t.icon || "?";
        iconEl.dataset.imageLoading = "1";
        mountThreatImage(d.threatId, iconEl, {
          imgClass: "threat-img",
          fallbackEmoji: t.icon || "?",
        })
          .catch(() => {})
          .finally(() => {
            delete iconEl.dataset.imageLoading;
          });
      }
      div.querySelector('[data-role="label"]').textContent = t.name || "";
      div.dataset.category = t.category;
      return div;
    };
  }
}
