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
import { loadThreatImage } from "./threatImage.js";

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
 * Color a usar para una amenaza: dominante del emoji, con fallback a
 * `t.color` del catálogo y luego al color genérico de la categoría.
 */
export function colorForThreat(t) {
  if (!t) return "#888888";
  const dom = dominantColorFromEmoji(
    t.icon,
    t.color || COLOR_BY_CATEGORY[t.category] || "#888888",
  );
  return dom;
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
  getPointsData() {
    const out = [];
    for (const id of this.activeIds) {
      const t = THREATS[id];
      if (!t) continue;
      const color = colorForThreat(t);
      // Altura del cilindro: proporcional al power (1..5) → 0.05..0.25
      const altitude = 0.04 + (t.power || 3) * 0.04;
      out.push({
        threatId: id,
        lat: t.lat,
        lng: t.lon,
        altitude,
        radius: 0.4, // radio del cilindro en grados (visual)
        color,
        label: t.name,
      });
    }
    return out;
  }

  // ─── Capa 2: anillos pulsantes (ringsData) ────────────────────────────
  getRingsData() {
    const out = [];
    for (const id of this.activeIds) {
      const t = THREATS[id];
      if (!t) continue;
      const color = colorForThreat(t);
      out.push({
        threatId: id,
        lat: t.lat,
        lng: t.lon,
        // maxR en grados (1° ≈ 111 km). Lo ajustamos al radio de la amenaza.
        maxR: Math.min(t.radius_km / 111, 12),
        propagationSpeed: Math.max(0.5, (t.power || 3) * 0.3),
        repeatPeriod: 1500,
        color,
      });
    }
    return out;
  }

  // ─── Capa 3: HTML elements (emoji + nombre) ───────────────────────────
  getHtmlElementsData() {
    const out = [];
    for (const id of this.activeIds) {
      const t = THREATS[id];
      if (!t) continue;
      const color = colorForThreat(t);
      // Lo ponemos a una altura mayor que la columna para que flote arriba.
      const altitude = 0.04 + (t.power || 3) * 0.04 + 0.03;
      out.push({
        threatId: id,
        lat: t.lat,
        lng: t.lon,
        alt: altitude,
        threat: t,
        color,
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
        div.style.pointerEvents = "auto";
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

        // Intentar reemplazar el emoji por una imagen real si existe en
        // public/threats/<id>.png|jpg|webp. El fondo negro se hace
        // transparente automáticamente. Si no hay archivo, queda el emoji.
        loadThreatImage(d.threatId)
          .then((dataUrl) => {
            if (!dataUrl) return;
            const img = document.createElement("img");
            img.src = dataUrl;
            img.alt = "";
            img.draggable = false;
            img.className = "threat-img";
            icon.textContent = "";
            icon.appendChild(img);
            icon.classList.add("has-image");
          })
          .catch(() => {
            /* fallback al emoji, ya está */
          });

        this._domCache.set(d.threatId, div);
      }
      const t = d.threat;
      div.style.setProperty("--threat-color", d.color);
      const iconEl = div.querySelector('[data-role="icon"]');
      // Solo seteamos el emoji mientras no hayamos cargado la imagen.
      if (!iconEl.classList.contains("has-image")) {
        iconEl.textContent = t.icon || "?";
      }
      div.querySelector('[data-role="label"]').textContent = t.name || "";
      div.dataset.category = t.category;
      return div;
    };
  }
}
