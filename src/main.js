// Bootstrap del juego "Paranormal Hunt — Globe Edition".
// Stack: Vite + globe.gl (Three.js) + módulos JS nativos.

import Globe from "globe.gl";

import { fetchAircraft } from "./opensky.js";
import { PRESETS, REGIONES } from "./presets.js";
import { AircraftManager } from "./aircraft.js";
import { flagFor } from "./flags.js";
import { THREATS, THREAT_CATEGORIES } from "./threats.js";
import { ThreatManager } from "./threatManager.js";
import { ThreatRenderer, colorForThreat } from "./threatRender.js";
import { Simulator } from "./simulator.js";
import {
  playAttackSound,
  playRescueSound,
  playLostSound,
  playGameOverSound,
  setMuted,
  isMuted,
} from "./audio.js";

// ── Constantes ───────────────────────────────────────────────────────────────
const EARTH_RADIUS_KM = 6371;
// Convierte una "altura sobre el suelo" en metros (como las usa Cesium en
// presets.js) a "altitude" en unidades de radio terrestre que pide globe.gl.
function metersToAltitude(m) {
  return m / 1000 / EARTH_RADIUS_KM;
}

// Texturas equirectangulares para el globo. Las hosteamos del CDN de
// `vasturiano/three-globe` que viene con el package globe.gl, así no
// dependemos de tener archivos en `public/`.
const GLOBE_THEMES = {
  dark: {
    label: "Dark",
    globeImageUrl:
      "//unpkg.com/three-globe/example/img/earth-night.jpg",
    bumpImageUrl:
      "//unpkg.com/three-globe/example/img/earth-topology.png",
    backgroundImageUrl:
      "//unpkg.com/three-globe/example/img/night-sky.png",
    atmosphereColor: "#3399cc",
    atmosphereAltitude: 0.18,
  },
};
const currentTheme = "dark";

// ── Setup del globo ──────────────────────────────────────────────────────────
const container = document.getElementById("globeContainer");
const theme = GLOBE_THEMES[currentTheme];

const globe = new Globe(container)
  .globeImageUrl(theme.globeImageUrl)
  .bumpImageUrl(theme.bumpImageUrl)
  .backgroundImageUrl(theme.backgroundImageUrl)
  .atmosphereColor(theme.atmosphereColor)
  .atmosphereAltitude(theme.atmosphereAltitude)
  .showAtmosphere(true)
  .showGraticules(false);

// ── Capa de ciudades (Natural Earth populated places) ────────────────────────
// Dataset liviano (~80 KB) con ~250 ciudades grandes del mundo, su población
// y país. Lo usamos como label layer del globo para dar contexto geográfico.
const CITIES_URL =
  "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_populated_places_simple.geojson";

(async () => {
  try {
    const res = await fetch(CITIES_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson = await res.json();
    // Cada feature tiene: properties.name, latitude, longitude, pop_max
    const cities = geojson.features
      .filter((f) => f.properties.pop_max > 200_000)
      .map((f) => f.properties);
    globe
      .labelsData(cities)
      .labelLat((d) => d.latitude)
      .labelLng((d) => d.longitude)
      .labelText((d) => d.name)
      .labelSize((d) => Math.sqrt(d.pop_max) * 3e-4)
      .labelDotRadius((d) => Math.sqrt(d.pop_max) * 3e-4)
      .labelColor(() => "rgba(255, 180, 70, 0.75)")
      .labelResolution(2)
      .labelAltitude(0.005)
      .labelIncludeDot(true);
    console.log(`[cities] loaded ${cities.length}`);
  } catch (err) {
    console.warn("[cities] no se pudo cargar el dataset", err);
  }
})();

// Auto-rotación: prendida por default, sólo se apaga / prende desde el botón
// 🔄 del header. OrbitControls ya pausa la rotación naturalmente mientras el
// usuario está arrastrando, y la reanuda al soltar.
const controls = globe.controls();
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.6;
controls.zoomSpeed = 0.9;

// ── Sizing y altura dinámicos de las amenazas ───────────────────────────────
// Cuando el jugador está en vista global, los markers se ven chicos y altos
// (encima de la columna 3D). Cuando se acerca, escalan más grandes y bajan
// hasta casi tocar la superficie, así la amenaza se ve "en su contexto"
// geográfico en lugar de flotando en el aire.
let currentCamAlt = 2.5;
let lastRefreshedAlt = -1;
const ALT_REFRESH_DELTA = 0.06; // disparo refresh cada 6% de cambio
function updateThreatMarkerScale() {
  const pov = globe.pointOfView();
  const alt = pov?.altitude ?? 2.5;
  currentCamAlt = alt;

  // Escala (mucho más grande al acercarse para que la amenaza sea bien
  // legible en zoom in). Curva: 0.7 (lejos) → 4.0 (muy cerca).
  let scale;
  if (alt > 2.5) scale = 0.7;
  else if (alt > 1.0) scale = 0.7 + (1 - (alt - 1.0) / 1.5) * 0.7;   // → 1.4
  else if (alt > 0.4) scale = 1.4 + (1 - (alt - 0.4) / 0.6) * 1.0;   // → 2.4
  else if (alt > 0.15) scale = 2.4 + (1 - (alt - 0.15) / 0.25) * 1.1; // → 3.5
  else scale = 3.5 + (1 - alt / 0.15) * 0.8;                          // → 4.3
  document.documentElement.style.setProperty(
    "--threat-marker-scale",
    scale.toFixed(2)
  );

  // Si la altitude cambió suficiente, re-aplicamos los htmlElements para
  // que el accessor de altitude se vuelva a evaluar (los markers descienden
  // hacia la superficie en zoom in).
  if (Math.abs(alt - lastRefreshedAlt) > ALT_REFRESH_DELTA) {
    lastRefreshedAlt = alt;
    // refreshThreatLayers se declara más abajo: lo invocamos diferido para
    // evitar TDZ en la primera llamada al inicializar.
    queueMicrotask(() => {
      if (threatLayersReady) refreshThreatLayers();
    });
  }
}
let threatLayersReady = false;
controls.addEventListener("change", updateThreatMarkerScale);
// La primera llamada se hace después del bootstrap, no acá: la dispara el
// flag threatLayersReady = true al final del módulo.
updateThreatMarkerScale();

/**
 * Mezcla la altitude "tope de columna" (cuando estamos lejos) con
 * "casi en superficie" (cuando estamos zoom in), según `currentCamAlt`.
 *   camAlt >= 2.0  → top of column (igual que antes)
 *   camAlt <= 0.3  → casi pegado a la superficie
 */
function threatMarkerAltitude(topAlt) {
  const surface = 0.005;
  let mix;
  if (currentCamAlt >= 2.0) mix = 0;
  else if (currentCamAlt <= 0.3) mix = 1;
  else mix = (2.0 - currentCamAlt) / 1.7;
  return topAlt * (1 - mix) + surface * mix;
}

// Resize: globe.gl no se ajusta solo cuando cambia el viewport.
function fitGlobe() {
  globe.width(container.clientWidth);
  globe.height(container.clientHeight);
}
fitGlobe();
window.addEventListener("resize", fitGlobe);

// ── Estado de la app ─────────────────────────────────────────────────────────
const state = {
  presetKey: "GLOBE",
  preset: { lat: 0, lon: 0, height: 24_000_000, label: "Globe", region: "Mundo" },
  selectedIcao: null,
  pollIntervalMs: 10_000,
  simIntervalMs: 1_500,
  lastAircraftList: [],
  mode: "SIM",
  lastAttackSoundAt: 0,
};

// ── Managers ─────────────────────────────────────────────────────────────────
const aircraftMgr = new AircraftManager();
const threatRenderer = new ThreatRenderer();
const threatMgr = new ThreatManager(null);
const simulator = new Simulator(80);

// El threatManager espera un viewer Cesium con `camera.positionCartographic`
// para calcular proximidad. Como ya no hay cámara cercana al avión (todo
// es a nivel global) deshabilitamos el rescate por proximidad por completo.
threatMgr.setProximityRescueEnabled(false);

// ── Refs DOM del HUD ─────────────────────────────────────────────────────────
const hud = {
  score: document.getElementById("stat-score"),
  lives: document.getElementById("stat-lives"),
  rescued: document.getElementById("stat-rescued"),
  lost: document.getElementById("stat-lost"),
  aviones: document.getElementById("stat-aviones"),
  attacked: document.getElementById("stat-attacked"),
  api: document.getElementById("stat-api"),
  utc: document.getElementById("stat-utc"),
  hudTitle: document.getElementById("hud-title"),
  aircraftList: document.getElementById("aircraft-list"),
  presetsList: document.getElementById("presets-list"),
  threatsList: document.getElementById("threats-list"),
  commsLog: document.getElementById("comms-log"),
  detail: document.getElementById("hud-detail"),
  detailClose: document.getElementById("detail-close"),
  detailCallsign: document.getElementById("detail-callsign"),
  detailIcao: document.getElementById("detail-icao"),
  detailFl: document.getElementById("detail-fl"),
  detailVel: document.getElementById("detail-vel"),
  detailHdg: document.getElementById("detail-hdg"),
  detailVario: document.getElementById("detail-vario"),
  detailOrig: document.getElementById("detail-orig"),
  attackBanner: document.getElementById("attack-banner"),
  attackTitle: document.getElementById("attack-title"),
  attackSource: document.getElementById("attack-source"),
  attackIcon: document.getElementById("attack-icon"),
  timerFill: document.getElementById("timer-fill"),
  timerText: document.getElementById("timer-text"),
  btnRescue: document.getElementById("btn-rescue"),
  rescueHint: document.getElementById("rescue-hint"),
  threatDetail: document.getElementById("threat-detail"),
  threatDetailClose: document.getElementById("threat-detail-close"),
  tdIcon: document.getElementById("td-icon"),
  tdName: document.getElementById("td-name"),
  tdRegion: document.getElementById("td-region"),
  tdDesc: document.getElementById("td-desc"),
  tdCategory: document.getElementById("td-category"),
  tdPower: document.getElementById("td-power"),
  tdRadius: document.getElementById("td-radius"),
  tdStatus: document.getElementById("td-status"),
  tdLat: document.getElementById("td-lat"),
  tdLon: document.getElementById("td-lon"),
  tdFly: document.getElementById("td-fly"),
  toastStack: document.getElementById("toast-stack"),
};

// ── Cámara: pointOfView helpers ──────────────────────────────────────────────
function flyTo(lat, lng, altitude, ms = 1500) {
  globe.pointOfView({ lat, lng, altitude }, ms);
}

function flyToGlobe() {
  state.presetKey = "GLOBE";
  hud.hudTitle.textContent = "PARANORMAL HUNT";
  flyTo(15, 0, 2.5, 1800);
  document
    .querySelectorAll(".preset-row")
    .forEach((el) => el.classList.remove("active"));
}

function flyToPreset(presetKey) {
  const p = PRESETS[presetKey];
  if (!p) return;
  state.presetKey = presetKey;
  state.preset = p;
  hud.hudTitle.textContent = p.label.toUpperCase();
  // Convertir height en metros → altitude (radios). Aplicamos una escala
  // suave para que vistas de aeropuerto no queden tan pegadas.
  const altitude = Math.max(0.08, metersToAltitude(p.height) * 1.6);
  flyTo(p.lat, p.lon, altitude, 1500);
  document.querySelectorAll(".preset-row").forEach((el) => {
    el.classList.toggle("active", el.dataset.preset === presetKey);
  });
}

function flyToAircraft(icao) {
  const ac = aircraftMgr.getById(icao);
  if (!ac) return;
  // Offset hacia el sur (latitud menor) para que el avión quede un poco
  // arriba del centro, así no lo tapa el panel inferior. En mobile el
  // panel ocupa más relativo a la pantalla, pero usar un offset chico
  // (~3.5°) deja al avión visible y centrado horizontalmente.
  const altitude = 0.18;
  const isMobile = window.matchMedia("(max-width: 900px)").matches;
  const latOffset = isMobile ? 3.5 : 5;
  let centerLat = ac.lat - latOffset;
  if (centerLat < -85) centerLat = -85;
  if (centerLat > 85) centerLat = 85;
  flyTo(centerLat, ac.lon, altitude, 1400);
}

function flyToThreat(threatId) {
  const t = THREATS[threatId];
  if (!t) return;
  // Altura proporcional al radius; amenazas globales como Bermuda se ven mejor
  // un poco más arriba para apreciar el radio entero.
  const altitude = Math.max(0.18, t.radius_km / 5_000);
  flyTo(t.lat, t.lon, altitude, 1500);
}

// ── Tiempo UTC ───────────────────────────────────────────────────────────────
setInterval(() => {
  const now = new Date();
  hud.utc.textContent = now.toISOString().substring(11, 19);
}, 1000);

// ── Selección de avión ───────────────────────────────────────────────────────
// Estado de "rastreo": cuando se selecciona un avión bajo ataque, paramos la
// auto-rotación y centramos la cámara. Guardamos el estado previo del rotate
// para restaurarlo al rescatar / cerrar el panel.
const followState = {
  active: false,
  prevAutoRotate: false,
  icao: null,
};

function startFollow(ac) {
  if (followState.active) return;
  followState.active = true;
  followState.icao = ac.icao;
  followState.prevAutoRotate = controls.autoRotate;
  controls.autoRotate = false;
  // Reflejar el cambio visual en el botón
  btnRotate?.classList.toggle("active-rotate", false);
  flyToAircraft(ac.icao);
}

function stopFollow({ flyBack = true } = {}) {
  if (!followState.active) return;
  const wasRotating = followState.prevAutoRotate;
  followState.active = false;
  followState.icao = null;
  if (flyBack) flyToGlobe();
  if (wasRotating) {
    controls.autoRotate = true;
    btnRotate?.classList.toggle("active-rotate", true);
  }
}

function selectAircraft(icao) {
  state.selectedIcao = icao;
  aircraftMgr.setSelected(icao);
  refreshAircraftLayer();
  if (!icao) {
    hud.detail.classList.add("hidden");
    // Si veníamos siguiendo un avión, volvemos a la vista global.
    if (followState.active) stopFollow({ flyBack: true });
    return;
  }
  const ac = aircraftMgr.getById(icao);
  if (!ac) return;

  hud.detail.classList.remove("hidden");
  hud.detailCallsign.textContent = `${flagFor(ac.origin_country) || ""} ${ac.callsign || ac.icao}`.trim();
  hud.detailIcao.textContent = ac.icao;
  hud.detailFl.textContent = ac.geo_alt
    ? `FL${Math.round((ac.geo_alt * 3.281) / 100)
        .toString()
        .padStart(3, "0")}`
    : "--";
  hud.detailVel.textContent = ac.velocity ? `${Math.round(ac.velocity * 1.944)} kt` : "--";
  hud.detailHdg.textContent = ac.heading != null ? `${Math.round(ac.heading)}°` : "--";
  hud.detailVario.textContent =
    ac.vertical_rate != null ? `${(ac.vertical_rate * 196.85).toFixed(0)} fpm` : "--";
  hud.detailOrig.textContent = ac.origin_country || "--";

  refreshAttackBanner();

  // Si está bajo ataque, centramos y paramos la rotación automáticamente.
  // Reemplaza al viejo botón "CENTRAR" que se eliminó.
  if (threatMgr.isUnderAttack(icao)) {
    startFollow(ac);
  }
}

aircraftMgr.onClick = (icao) => selectAircraft(icao);
threatRenderer.onClick = (id) => showThreatDetail(id);

hud.detailClose.addEventListener("click", () => selectAircraft(null));

// ── Threat detail panel ──────────────────────────────────────────────────────
function showThreatDetail(threatId) {
  const t = THREATS[threatId];
  if (!t) return;
  // Color dinámico del panel según el color dominante del emoji de la amenaza
  const rgb = hexToRgb(colorForThreat(t));
  if (rgb) {
    hud.threatDetail.style.setProperty("--tr", rgb.r);
    hud.threatDetail.style.setProperty("--tg", rgb.g);
    hud.threatDetail.style.setProperty("--tb", rgb.b);
  }
  hud.threatDetail.classList.remove("hidden");
  hud.tdIcon.textContent = t.icon;
  hud.tdName.textContent = t.name;
  hud.tdRegion.textContent = t.region || "";
  hud.tdDesc.textContent = t.desc || "";
  const catMeta = THREAT_CATEGORIES[t.category];
  hud.tdCategory.textContent = catMeta?.label ?? t.category.toUpperCase();
  hud.tdPower.textContent = "★".repeat(t.power || 1) + "☆".repeat(5 - (t.power || 1));
  hud.tdRadius.textContent = `${t.radius_km} km`;
  hud.tdStatus.textContent = threatMgr.isActive(threatId) ? "ACTIVA" : "INACTIVA";
  hud.tdLat.textContent = t.lat.toFixed(3);
  hud.tdLon.textContent = t.lon.toFixed(3);
  hud.tdFly.dataset.threatId = threatId;
}

hud.threatDetailClose.addEventListener("click", () => {
  hud.threatDetail.classList.add("hidden");
});
hud.tdFly.addEventListener("click", () => {
  const id = hud.tdFly.dataset.threatId;
  if (id) flyToThreat(id);
});

function hexToRgb(hex) {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return null;
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

// ── Attack banner (tiempo restante para rescatar) ────────────────────────────
function refreshAttackBanner() {
  const icao = state.selectedIcao;
  if (!icao) return;
  const info = threatMgr.getAttackInfo(icao);
  if (!info || info.rescued) {
    hud.attackBanner.classList.add("hidden");
    hud.btnRescue.disabled = true;
    return;
  }
  const t = THREATS[info.threatId];
  hud.attackBanner.classList.remove("hidden");
  hud.attackTitle.textContent = "BAJO ATAQUE";
  hud.attackSource.textContent = `${t.icon} ${t.name}`;
  hud.attackIcon.textContent = t.icon;
  const remaining = Math.max(0, info.deadlineMs - Date.now());
  const total = info.deadlineMs - info.startedAt;
  const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
  hud.timerFill.style.width = `${pct}%`;
  hud.timerText.textContent = `${Math.ceil(remaining / 1000)}s`;
  hud.btnRescue.disabled = false;
}
setInterval(refreshAttackBanner, 500);

// ── Layers de globe.gl: aviones + amenazas ───────────────────────────────────
// pointsData (columnas) + ringsData (pulsos) + htmlElementsData (emoji)
//
// globe.gl es eficiente al actualizar layers: solo re-rendea los items
// nuevos. Pero para que el HEADING del avión se rote, necesitamos forzar
// una re-aplicación de htmlElementsData en cada poll, porque el callback
// de htmlElement no se ejecuta de nuevo para items existentes.
//
// Estrategia: refrescamos el array completo en cada poll, pero el manager
// reutiliza el mismo div por icao y solo actualiza sus props (no recrea).

function refreshAircraftLayer() {
  globe
    .htmlElementsData(getAllHtmlElementsData())
    .ringsData(getAllRingsData());
}
function refreshThreatLayers() {
  // Las columnas (pointsData) se reducen también al acercarse, así no quedan
  // como un palo gigante al costado de la imagen cuando estás cerca.
  const points = threatRenderer.getPointsData().map((p) => ({
    ...p,
    altitude: threatColumnAltitude(p.altitude),
  }));
  globe.pointsData(points).ringsData(getAllRingsData());
  globe.htmlElementsData(getAllHtmlElementsData());
}

function threatColumnAltitude(topAlt) {
  // camAlt >= 2.0 → altura completa
  // camAlt <= 0.3 → muy reducida (12% del tope)
  let factor;
  if (currentCamAlt >= 2.0) factor = 1.0;
  else if (currentCamAlt <= 0.3) factor = 0.12;
  else factor = 0.12 + ((currentCamAlt - 0.3) / 1.7) * 0.88;
  return topAlt * factor;
}

// Rings combinados: amenazas (anillos lentos amplios) + aviones bajo ataque
// (anillos rápidos rojos pequeños) + escudos de rescate (anillos verdes
// efímeros que celebran un rescate exitoso, estilo earth-shield).
function getAllRingsData() {
  return [
    ...threatRenderer.getRingsData(),
    ...aircraftMgr.getAttackedRingsData(),
    ...getRescueShieldsData(),
  ];
}

// Escudos de rescate: cuando el jugador rescata un avión, aparece sobre su
// posición un escudo verde que pulsa durante ~2 segundos y luego se va.
const activeShields = new Map(); // icao -> {lat, lng, expireAt}
const SHIELD_DURATION_MS = 2200;

function spawnRescueShield(ac) {
  if (!ac || ac.lat == null || ac.lon == null) return;
  activeShields.set(ac.icao, {
    icao: ac.icao,
    lat: ac.lat,
    lng: ac.lon,
    expireAt: Date.now() + SHIELD_DURATION_MS,
  });
  refreshAircraftLayer();
  // Auto-cleanup
  setTimeout(() => {
    const s = activeShields.get(ac.icao);
    if (s && Date.now() >= s.expireAt) {
      activeShields.delete(ac.icao);
      refreshAircraftLayer();
    }
  }, SHIELD_DURATION_MS + 100);
}

function getRescueShieldsData() {
  const out = [];
  const now = Date.now();
  for (const s of activeShields.values()) {
    if (now >= s.expireAt) continue;
    out.push({
      kind: "shield",
      icao: s.icao,
      lat: s.lat,
      lng: s.lng,
      // Anillo grande, propagación rápida, repite seguido (efecto burst).
      maxR: 6,
      propagationSpeed: 14,
      repeatPeriod: 250,
      altitude: 0.025, // por encima del globo, tipo aura
      color: "#00ff7f",
    });
  }
  return out;
}

// Interpolador de color: recibe un color hex y devuelve una función t→rgba
// con alpha decreciente (sqrt(1-t)) para el efecto de "ripple" que se desvanece.
function ringColorInterpolator(hex) {
  const rgb = hexToRgb(hex) || { r: 255, g: 255, b: 255 };
  return (t) => `rgba(${rgb.r},${rgb.g},${rgb.b},${Math.sqrt(1 - t)})`;
}

// Combinamos aviones + amenazas en una sola lista de htmlElements.
// Usamos un campo `__kind` para dispatcher al element builder correcto.
// Las amenazas usan altitude dinámica: alto en vista global, descienden
// hasta cerca de la superficie cuando el jugador hace zoom in.
function getAllHtmlElementsData() {
  const planes = aircraftMgr.getHtmlElementsData().map((d) => ({
    ...d,
    __kind: "plane",
  }));
  const threats = threatRenderer.getHtmlElementsData().map((d) => ({
    ...d,
    alt: threatMarkerAltitude(d.alt),
    __kind: "threat",
  }));
  return [...planes, ...threats];
}

const planeBuilder = aircraftMgr.getElementBuilder();
const threatBuilder = threatRenderer.getElementBuilder();

globe
  // Columnas verticales para amenazas
  .pointLat("lat")
  .pointLng("lng")
  .pointAltitude("altitude")
  .pointColor("color")
  .pointRadius((d) => d.radius || 0.4)
  .pointResolution(8)
  .pointsData([])

  // Anillos pulsantes (amenazas, aviones bajo ataque y escudos de rescate)
  .ringLat("lat")
  .ringLng("lng")
  .ringAltitude((d) => d.altitude || 0)
  .ringMaxRadius("maxR")
  .ringPropagationSpeed("propagationSpeed")
  .ringRepeatPeriod("repeatPeriod")
  .ringColor((d) => ringColorInterpolator(d.color))
  .ringsData([])

  // HTML markers (aviones + emoji de amenaza)
  .htmlLat("lat")
  .htmlLng("lng")
  .htmlAltitude("alt")
  .htmlElement((d) => (d.__kind === "plane" ? planeBuilder(d) : threatBuilder(d)))
  .htmlElementsData([]);

// ── Render lists del HUD lateral ─────────────────────────────────────────────
function renderAircraftList(aircraft) {
  if (!aircraft.length) {
    hud.aircraftList.innerHTML = '<div class="empty">Sin tráfico</div>';
    return;
  }
  // Top 30, ordenados por bajo ataque primero, luego alfabético
  const sorted = [...aircraft]
    .sort((a, b) => {
      const aA = threatMgr.isUnderAttack(a.icao) ? 1 : 0;
      const bA = threatMgr.isUnderAttack(b.icao) ? 1 : 0;
      if (aA !== bA) return bA - aA;
      return (a.callsign || "").localeCompare(b.callsign || "");
    })
    .slice(0, 30);

  hud.aircraftList.innerHTML = sorted
    .map((ac) => {
      const flag = flagFor(ac.origin_country) || "";
      const attacked = threatMgr.isUnderAttack(ac.icao) ? " attacked" : "";
      const sel = state.selectedIcao === ac.icao ? " selected" : "";
      const fl = ac.geo_alt
        ? `FL${Math.round((ac.geo_alt * 3.281) / 100)
            .toString()
            .padStart(3, "0")}`
        : "--";
      return `<div class="aircraft-row${attacked}${sel}" data-icao="${ac.icao}">
        <span class="flag">${flag}</span>
        <span class="cs">${ac.callsign || ac.icao}</span>
        <span class="alt">${fl}</span>
      </div>`;
    })
    .join("");

  hud.aircraftList.querySelectorAll(".aircraft-row").forEach((el) => {
    el.addEventListener("click", () => selectAircraft(el.dataset.icao));
  });
}

function renderPresetsList() {
  const html = Object.entries(REGIONES)
    .map(([region, keys]) => {
      const rows = keys
        .map((k) => {
          const p = PRESETS[k];
          if (!p) return "";
          return `<div class="preset-row" data-preset="${k}">
            <span class="icao">${p.icao}</span>
            <span class="name">${p.label}</span>
          </div>`;
        })
        .join("");
      return `<div class="preset-region">
        <div class="region-label">${region}</div>
        ${rows}
      </div>`;
    })
    .join("");
  hud.presetsList.innerHTML = html;
  hud.presetsList.querySelectorAll(".preset-row").forEach((el) => {
    el.addEventListener("click", () => flyToPreset(el.dataset.preset));
  });
}
renderPresetsList();

function renderThreatsList() {
  const grouped = { ufo: [], paranormal: [], creature: [] };
  for (const [id, t] of Object.entries(THREATS)) {
    grouped[t.category].push({ id, ...t });
  }
  let html = "";
  for (const cat of ["ufo", "paranormal", "creature"]) {
    const meta = THREAT_CATEGORIES[cat];
    html += `<div class="threat-category"><div class="region-label">${meta.icon} ${meta.label}</div>`;
    html += grouped[cat]
      .map((t) => {
        const active = threatMgr.isActive(t.id) ? " active" : "";
        const c = colorForThreat(t);
        return `<div class="threat-row${active}" data-threat="${t.id}" style="--threat-row-color:${c}">
          <span class="threat-icon-small">${t.icon}</span>
          <span class="threat-name">${t.name}</span>
          <span class="threat-power">★${t.power}</span>
        </div>`;
      })
      .join("");
    html += "</div>";
  }
  hud.threatsList.innerHTML = html;
  hud.threatsList.querySelectorAll(".threat-row").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.threat;
      if (threatMgr.isActive(id)) {
        threatMgr.toggleThreat(id);
        threatRenderer.hideThreat(id);
      } else {
        threatMgr.toggleThreat(id);
        threatRenderer.showThreat(id);
      }
      el.classList.toggle("active");
      refreshThreatLayers();
    });
  });
}
renderThreatsList();

// ── Tabs del sidebar ─────────────────────────────────────────────────────────
document.querySelectorAll(".hud-tabs .tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".hud-tabs .tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    const t = btn.dataset.tab;
    document.querySelector(`.tab-content[data-tab="${t}"]`).classList.add("active");
  });
});

// ── State callbacks del threatManager ────────────────────────────────────────
threatMgr.callbacks.onState = (s) => {
  hud.score.textContent = s.score;
  hud.lives.textContent = "❤".repeat(Math.max(0, s.lives)) + "🤍".repeat(Math.max(0, 3 - s.lives));
  hud.rescued.textContent = s.rescued;
  hud.lost.textContent = s.lost;
  hud.attacked.textContent = s.attackedCount;
  // En mobile el botón hamburguesa titila rojo cuando hay ataques activos
  // para llamar la atención del jugador hacia el listado de aviones.
  document.getElementById("btn-menu")?.classList.toggle("alert", s.attackedCount > 0);
};

threatMgr.callbacks.onEvent = (ev) => {
  appendComms(ev);
  if (ev.type === "AIRCRAFT_ATTACK") {
    const now = Date.now();
    if (now - state.lastAttackSoundAt > 1500) {
      playAttackSound();
      state.lastAttackSoundAt = now;
    }
    showToast(ev.msg, "warn");
  } else if (ev.type === "RESCUE_OK") {
    playRescueSound();
    showToast(ev.msg, "ok");
    if (ev.ac) spawnRescueShield(ev.ac);
    // Si el rescatado es el avión que estábamos siguiendo, dejamos que la
    // animación del escudo termine y volvemos a la vista de globo +
    // reanudamos la rotación si estaba prendida.
    if (followState.active && ev.ac && ev.ac.icao === followState.icao) {
      const dur = SHIELD_DURATION_MS + 200;
      setTimeout(() => {
        // Cierra el panel y dispara stopFollow internamente
        selectAircraft(null);
      }, dur);
    }
  } else if (ev.type === "LOST") {
    playLostSound();
    showToast(ev.msg, "danger");
  } else if (ev.type === "GAME_OVER") {
    playGameOverSound();
    showToast(ev.msg, "danger");
  } else if (ev.type === "RESCUE_FAR") {
    showToast(ev.msg, "warn");
  } else if (ev.type === "ATTACK") {
    showToast(ev.msg, "warn");
  }
};

function showToast(msg, kind = "info") {
  const div = document.createElement("div");
  div.className = `toast toast-${kind}`;
  div.textContent = msg;
  hud.toastStack.appendChild(div);
  setTimeout(() => div.remove(), 4500);
}

function appendComms(ev) {
  const t = ev.t.toISOString().substring(11, 19);
  const html = `<div class="comms-entry">
    <span class="t">${t}</span>
    <span class="msg">${ev.msg}</span>
  </div>`;
  if (hud.commsLog.querySelector(".empty")) hud.commsLog.innerHTML = "";
  hud.commsLog.insertAdjacentHTML("afterbegin", html);
}

// ── Game loop ────────────────────────────────────────────────────────────────
async function pollOnce() {
  let aircraft;
  if (state.mode === "SIM") {
    aircraft = simulator.getAircraft();
    hud.api.textContent = "SIM";
    hud.api.style.color = "#ffaa00";
  } else {
    const result = await fetchAircraft({ lamin: -90, lamax: 90, lomin: -180, lomax: 180 });
    if (!result.ok) {
      hud.api.textContent = result.status === 429 ? "RATE_LIMIT" : "ERR";
      hud.api.style.color = "#ff8080";
      return;
    }
    aircraft = result.aircraft;
    hud.api.textContent =
      result.creditsRemaining != null ? `${result.creditsRemaining}` : "OK";
    hud.api.style.color = "#00ff7f";
  }
  state.lastAircraftList = aircraft;
  aircraftMgr.upsert(aircraft);
  threatMgr.updateAttacks(aircraft);
  aircraftMgr.setAttackedIcaos(threatMgr.attackedList().map((i) => i.ac.icao));
  hud.aviones.textContent = aircraftMgr.count();
  renderAircraftList(aircraft);
  refreshAircraftLayer();
}


let pollHandle = null;
function restartPollLoop() {
  if (pollHandle) clearInterval(pollHandle);
  pollOnce();
  const ms = state.mode === "SIM" ? state.simIntervalMs : state.pollIntervalMs;
  pollHandle = setInterval(pollOnce, ms);
}

// Tick más rápido para timers de rescate (no necesita poll de aviones)
setInterval(() => {
  threatMgr.tick();
  aircraftMgr.setAttackedIcaos(threatMgr.attackedList().map((i) => i.ac.icao));
  refreshAttackBanner();
  refreshAircraftLayer();
}, 1000);

// ── Botones de acción ────────────────────────────────────────────────────────
hud.btnRescue.addEventListener("click", () => {
  if (!state.selectedIcao) return;
  threatMgr.manualRescue(state.selectedIcao);
});

// ── Activación masiva de amenazas ────────────────────────────────────────────
function activateAllThreats(filter = null, { silent = true } = {}) {
  let count = 0;
  for (const [id, t] of Object.entries(THREATS)) {
    if (filter && t.category !== filter) continue;
    if (!threatMgr.isActive(id)) {
      threatMgr.toggleThreat(id, { silent });
      threatRenderer.showThreat(id);
      count++;
    }
  }
  refreshThreatLayers();
  renderThreatsList();
  return count;
}
function deactivateAllThreats() {
  let count = 0;
  for (const id of Object.keys(THREATS)) {
    if (threatMgr.isActive(id)) {
      threatMgr.toggleThreat(id);
      threatRenderer.hideThreat(id);
      count++;
    }
  }
  refreshThreatLayers();
  renderThreatsList();
  return count;
}

document.getElementById("threats-all-on").addEventListener("click", () => {
  activateAllThreats(null, { silent: false });
});
document.getElementById("threats-all-off").addEventListener("click", () => {
  deactivateAllThreats();
});
document.querySelectorAll(".threats-btn.cat").forEach((btn) => {
  btn.addEventListener("click", () => {
    activateAllThreats(btn.dataset.cat, { silent: false });
  });
});

// ── Mute toggle ──────────────────────────────────────────────────────────────
const btnMute = document.getElementById("btn-mute");
btnMute.addEventListener("click", () => {
  const muted = !isMuted();
  setMuted(muted);
  btnMute.textContent = muted ? "🔇" : "🔊";
  btnMute.classList.toggle("active", muted);
});

// ── Auto-rotate toggle ───────────────────────────────────────────────────────
const btnRotate = document.getElementById("btn-rotate");
// Estado inicial: prendido (boot ya seteó controls.autoRotate = true)
btnRotate.classList.add("active-rotate");
btnRotate.addEventListener("click", () => {
  controls.autoRotate = !controls.autoRotate;
  btnRotate.classList.toggle("active-rotate", controls.autoRotate);
});

// ── Mobile: hamburger menu / sidebar toggle ─────────────────────────────────
const btnMenu = document.getElementById("btn-menu");
const sidebarEl = document.getElementById("hud-side");
// backdrop dinámico (solo se inserta una vez)
const sideBackdrop = document.createElement("div");
sideBackdrop.className = "side-backdrop";
document.body.appendChild(sideBackdrop);

function openSidebar() {
  sidebarEl.classList.add("open");
  sideBackdrop.classList.add("visible");
}
function closeSidebar() {
  sidebarEl.classList.remove("open");
  sideBackdrop.classList.remove("visible");
}
function toggleSidebar() {
  if (sidebarEl.classList.contains("open")) closeSidebar();
  else openSidebar();
}

btnMenu?.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleSidebar();
});
sideBackdrop.addEventListener("click", closeSidebar);

function isMobileLayout() {
  return window.matchMedia("(max-width: 900px)").matches;
}

// Cerrar el sidebar automáticamente cuando el usuario toca un avión, zona o
// amenaza desde la lista (en mobile el panel tapaba todo el globo).
sidebarEl.addEventListener("click", (ev) => {
  const target = ev.target.closest(
    ".aircraft-row, .preset-row, .threat-row"
  );
  if (target && isMobileLayout()) {
    setTimeout(closeSidebar, 80);
  }
});

// ── Mobile: hit-test manual de markers ───────────────────────────────────────
// En dispositivos touch los markers tienen `pointer-events: none` (CSS) para
// que los gestos rotate/pinch sobre el globo funcionen aunque el dedo aterrice
// sobre un avión o amenaza. Detectamos el "tap" (touch corto y sin movimiento)
// y hacemos hit-test contra los bounding rects de los markers, despachando un
// click sintético al marker tappeado.
//
// Detección robusta de touch: matchMedia (pointer: coarse) falla en algunos
// browsers híbridos. Combinamos varios checks. Si hay touch, marcamos el body
// con .is-touch y el CSS desactiva pointer-events de los markers.
const isTouchDevice =
  "ontouchstart" in window ||
  (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
  window.matchMedia("(pointer: coarse)").matches;

if (isTouchDevice) {
  document.body.classList.add("is-touch");

  // En mobile globe.gl mete los HTML markers dentro de un wrapper (CSS2DRenderer
  // de Three.js). Por defecto ese wrapper captura touch events y bloquea los
  // gestos de OrbitControls. Lo identificamos buscando el div hijo de
  // #globeContainer que contiene los markers, y le apagamos pointer-events.
  // No tocamos OTROS divs (que pueden ser wrappers que contienen el canvas
  // de Three.js, los cuales SÍ necesitan recibir touch para rotate/zoom).
  function disableMarkerWrappersPE() {
    const candidates = container.querySelectorAll("div");
    for (const div of candidates) {
      // Solo divs que contienen markers (CSS2DRenderer dom).
      if (
        div.children.length > 0 &&
        (div.firstElementChild?.classList?.contains("plane-marker") ||
          div.firstElementChild?.classList?.contains("threat-marker") ||
          div.querySelector?.(":scope > .plane-marker, :scope > .threat-marker"))
      ) {
        if (div.style.pointerEvents !== "none") {
          div.style.pointerEvents = "none";
        }
      }
    }
  }
  // Ejecutar después del primer render y luego periódicamente por si el
  // wrapper se recrea (raro, pero por las dudas).
  setTimeout(disableMarkerWrappersPE, 200);
  setTimeout(disableMarkerWrappersPE, 800);
  setInterval(disableMarkerWrappersPE, 3000);
}

if (isTouchDevice) {
  let tapStartX = 0;
  let tapStartY = 0;
  let tapStartT = 0;
  let tapTouchId = null;
  let tapMoved = false;
  const TAP_MAX_DURATION_MS = 350;
  const TAP_MAX_MOVE_PX = 12;

  container.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) {
        // multi-touch (pinch zoom): cancelamos cualquier tap pendiente
        tapTouchId = null;
        return;
      }
      const t = e.touches[0];
      tapTouchId = t.identifier;
      tapStartX = t.clientX;
      tapStartY = t.clientY;
      tapStartT = Date.now();
      tapMoved = false;
    },
    { passive: true }
  );

  container.addEventListener(
    "touchmove",
    (e) => {
      if (tapTouchId == null) return;
      const t = Array.from(e.touches).find((x) => x.identifier === tapTouchId);
      if (!t) return;
      const dx = t.clientX - tapStartX;
      const dy = t.clientY - tapStartY;
      if (Math.hypot(dx, dy) > TAP_MAX_MOVE_PX) tapMoved = true;
    },
    { passive: true }
  );

  container.addEventListener(
    "touchend",
    (e) => {
      if (tapTouchId == null) return;
      const t = Array.from(e.changedTouches).find(
        (x) => x.identifier === tapTouchId
      );
      tapTouchId = null;
      if (!t || tapMoved) return;
      if (Date.now() - tapStartT > TAP_MAX_DURATION_MS) return;

      const x = t.clientX;
      const y = t.clientY;
      // Hit-test manual contra todos los markers visibles. Recorremos en
      // orden inverso para preferir el último renderizado (encima visualmente).
      const markers = document.querySelectorAll(
        ".threat-marker, .plane-marker"
      );
      let hit = null;
      for (let i = markers.length - 1; i >= 0; i--) {
        const r = markers[i].getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          hit = markers[i];
          break;
        }
      }
      if (hit) {
        // Despachamos un click "real" para que reuse los listeners ya
        // adjuntados por aircraft.js / threatRender.js.
        hit.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          })
        );
      }
    },
    { passive: true }
  );
}

// ── Boot ─────────────────────────────────────────────────────────────────────
flyToGlobe();
activateAllThreats(null, { silent: true });
restartPollLoop();

// Ahora sí, las layers están armadas y se puede ajustar dinámicamente
// la altura de los markers cuando el usuario haga zoom.
threatLayersReady = true;
// Ejecutamos una pasada inicial para colocar los markers en el preset actual.
refreshThreatLayers();

console.log("[paranormal-hunt] init OK", {
  preset: state.preset?.label,
  threatsAvailable: Object.keys(THREATS).length,
  threatsActive: threatMgr.activeThreats.size,
});
