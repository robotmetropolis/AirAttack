// Manejo de aviones para globe.gl.
// Cada avión se renderiza como un HTML element (div) con una silueta SVG
// rotada según el heading. Más liviano que un objeto Three.js custom
// y más fácil de estilar con CSS.

import { iconForCategory } from "./planeIcons.js";
import { flagFor } from "./flags.js";

// Categorías ADS-B (campo 17 de OpenSky con extended=1)
const CATEGORIA_TIPO = {
  0: "unknown",
  1: "unknown",
  2: "light",
  3: "small",
  4: "large",
  5: "high_vortex",
  6: "heavy",
  7: "high_perf",
  8: "rotor",
  10: "glider",
  11: "balloon",
  12: "ultralight",
  14: "uav",
  15: "space",
};

// Color por tipo, en formato CSS para el filter del SVG.
// Para tintar los SVGs blancos uso `filter: drop-shadow + hue-rotate` o
// directamente un `filter: brightness(0) saturate(100%) invert(...)`.
// Más simple: aplico color al div con `--accent` como CSS var y el SVG
// queda en blanco. El glow / outline lo da el CSS.
// Nota: el rojo se reserva para aviones BAJO ATAQUE (ver .plane-marker.attacked
// en style.css). Ningún tipo de avión usa rojo en su color base, así que el
// rojo pulsante es siempre señal de peligro.
const COLOR_POR_TIPO = {
  unknown: "#00ff7f",
  light: "#9bf06a",
  small: "#5ddc55",
  large: "#3aa0ff",
  high_vortex: "#ff8c1a",
  heavy: "#00d8d8", // cyan: heavy (B747 / A380 etc), antes era rojo y confundía con ataques
  high_perf: "#ffaa00",
  rotor: "#bb55ff",
  glider: "#cccccc",
  balloon: "#ffffff",
  ultralight: "#aaffaa",
  uav: "#888888",
  space: "#ff00ff",
};

function tipoDe(categoria) {
  return CATEGORIA_TIPO[categoria] || "unknown";
}
function colorDe(categoria) {
  return COLOR_POR_TIPO[tipoDe(categoria)] || COLOR_POR_TIPO.unknown;
}

/**
 * Manager de aviones para globe.gl.
 *
 * Mantiene:
 * - aircraft: Map<icao, ac>  (datos crudos del API o simulator)
 * - attacked: Set<icao>      (aviones bajo ataque, halo rojo)
 * - selected: icao | null    (avión seleccionado por el HUD)
 *
 * API:
 * - upsert(list)             actualiza datos
 * - setAttackedIcaos(list)   marca quiénes están bajo ataque
 * - setSelected(icao)        marca el seleccionado
 * - getHtmlElementsData()    devuelve array para globe.htmlElementsData(...)
 * - getElementBuilder()      devuelve función para globe.htmlElement(...)
 * - count()                  cantidad
 * - getById(icao)            datos crudos del avión
 */
export class AircraftManager {
  constructor() {
    this.aircraft = new Map();
    this.attacked = new Set();
    this.selected = null;
    // icao -> {div, img, label} para evitar recrear DOM
    this._domCache = new Map();
    // Callback opcional cuando se hace click en un avión
    this.onClick = null;
  }

  upsert(list) {
    const seen = new Set();
    for (const ac of list) {
      if (!ac || !ac.icao) continue;
      seen.add(ac.icao);
      this.aircraft.set(ac.icao, ac);
    }
    // Eliminar los que dejaron de existir (drift de simulator/API)
    for (const icao of [...this.aircraft.keys()]) {
      if (!seen.has(icao)) {
        this.aircraft.delete(icao);
        const dom = this._domCache.get(icao);
        if (dom) dom.div.remove();
        this._domCache.delete(icao);
      }
    }
  }

  setAttackedIcaos(icaos) {
    this.attacked = new Set(icaos);
  }

  setSelected(icao) {
    this.selected = icao;
  }

  getById(icao) {
    return this.aircraft.get(icao);
  }

  count() {
    return this.aircraft.size;
  }

  /**
   * Rings de alarma sobre los aviones bajo ataque. Para usar como
   * `globe.ringsData(...)` combinado con los rings de las amenazas.
   * Cada ring se propaga rápido y rojo para sensación de alerta.
   */
  getAttackedRingsData() {
    const out = [];
    for (const icao of this.attacked) {
      const ac = this.aircraft.get(icao);
      if (!ac || ac.lat == null || ac.lon == null) continue;
      out.push({
        kind: "attack",
        icao,
        lat: ac.lat,
        lng: ac.lon,
        maxR: 3,
        propagationSpeed: 4,
        repeatPeriod: 700,
        color: "#ff2244",
      });
    }
    return out;
  }

  /**
   * Array de datos para globe.gl htmlElementsData.
   * Cada item incluye lat/lng/alt + el ac crudo + flags de estado.
   */
  getHtmlElementsData() {
    const out = [];
    for (const ac of this.aircraft.values()) {
      if (ac.lat == null || ac.lon == null) continue;
      out.push({
        icao: ac.icao,
        lat: ac.lat,
        lng: ac.lon,
        alt: 0.01, // pequeña elevación sobre el globo (en unidades de radio)
        ac,
        attacked: this.attacked.has(ac.icao),
        selected: this.selected === ac.icao,
      });
    }
    return out;
  }

  /**
   * Builder para globe.gl `htmlElement`. Recibe el dato y devuelve un
   * DOMElement. Reutiliza divs por icao para evitar parpadeos.
   */
  getElementBuilder() {
    return (d) => {
      let entry = this._domCache.get(d.icao);
      if (!entry) {
        const div = document.createElement("div");
        div.className = "plane-marker";
        div.style.pointerEvents = "auto";
        div.style.cursor = "pointer";

        const img = document.createElement("img");
        img.className = "plane-img";
        img.draggable = false;
        div.appendChild(img);

        const label = document.createElement("div");
        label.className = "plane-label";
        div.appendChild(label);

        div.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.onClick?.(d.icao);
        });

        entry = { div, img, label };
        this._domCache.set(d.icao, entry);
      }
      this._refreshElement(entry, d);
      return entry.div;
    };
  }

  _refreshElement(entry, d) {
    const ac = d.ac;
    const tipo = tipoDe(ac.category);
    const color = colorDe(ac.category);

    entry.img.src = iconForCategory(tipo);
    entry.img.style.transform = `rotate(${ac.heading ?? 0}deg)`;

    entry.label.textContent = ac.callsign || ac.icao;
    const flag = flagFor(ac.origin_country);
    if (flag && flag !== "??") {
      entry.label.textContent = `${flag} ${ac.callsign || ac.icao}`;
    }

    entry.div.style.setProperty("--ac-color", color);
    entry.div.classList.toggle("attacked", !!d.attacked);
    entry.div.classList.toggle("selected", !!d.selected);
  }
}

export { tipoDe, colorDe };
