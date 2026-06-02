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
import {
  mountThreatImage,
  preloadThreatImages,
  setOnThreatImageReady,
} from "./threatImage.js";
import { Simulator } from "./simulator.js";
import {
  playAttackSound,
  playRescueSound,
  playLostSound,
  playGameOverSound,
  speakPilotAccept,
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

// Auto-rotate: pausa al volar hacia amenaza / seguir avión; vuelve tras 20s sin
// mover la cámara (arrastre, zoom o toque en el globo).
const IDLE_ROTATE_RESUME_MS = 20_000;
const autoRotateIdle = {
  paused: false,
  prevAutoRotate: true,
  lastActivity: Date.now(),
  timer: null,
};

function markCameraActivity() {
  autoRotateIdle.lastActivity = Date.now();
  if (autoRotateIdle.paused) scheduleAutoRotateResume();
}

function scheduleAutoRotateResume() {
  clearTimeout(autoRotateIdle.timer);
  autoRotateIdle.timer = setTimeout(() => {
    if (followState.active) {
      scheduleAutoRotateResume();
      return;
    }
    const idleFor = Date.now() - autoRotateIdle.lastActivity;
    if (idleFor < IDLE_ROTATE_RESUME_MS - 80) {
      scheduleAutoRotateResume();
      return;
    }
    resumeAutoRotateAfterIdle();
  }, IDLE_ROTATE_RESUME_MS);
}

function pauseAutoRotateForView() {
  if (!autoRotateIdle.paused) {
    autoRotateIdle.prevAutoRotate = controls.autoRotate;
  }
  autoRotateIdle.paused = true;
  controls.autoRotate = false;
  document.getElementById("btn-rotate")?.classList.remove("active-rotate");
  markCameraActivity();
}

function resumeAutoRotateAfterIdle() {
  const shouldRotate = autoRotateIdle.prevAutoRotate;
  autoRotateIdle.paused = false;
  clearTimeout(autoRotateIdle.timer);
  autoRotateIdle.timer = null;
  if (shouldRotate) {
    controls.autoRotate = true;
    document.getElementById("btn-rotate")?.classList.add("active-rotate");
  }
}

function clearAutoRotatePause({ restoreNow = false } = {}) {
  const was = autoRotateIdle.prevAutoRotate;
  autoRotateIdle.paused = false;
  clearTimeout(autoRotateIdle.timer);
  autoRotateIdle.timer = null;
  if (restoreNow && was) {
    controls.autoRotate = true;
    document.getElementById("btn-rotate")?.classList.add("active-rotate");
  }
}

function onControlsStart() {
  if (followState.active) followState.userPaused = true;
  markCameraActivity();
}
controls.addEventListener("start", onControlsStart);
controls.addEventListener("change", markCameraActivity);
controls.addEventListener("end", markCameraActivity);
container.addEventListener(
  "wheel",
  () => {
    if (followState.active) followState.userPaused = true;
    markCameraActivity();
  },
  { passive: true }
);

// ── Sizing y altura dinámicos de las amenazas ───────────────────────────────
// Cuando el jugador está en vista global, los markers se ven chicos y altos
// (encima de la columna 3D). Cuando se acerca, escalan más grandes y bajan
// hasta casi tocar la superficie, así la amenaza se ve "en su contexto"
// geográfico en lugar de flotando en el aire.
let currentCamAlt = 2.5;
let lastRefreshedAlt = -1;
let pillarsWereVisible = true;
let lastThreatCaptureSig = "";
const ALT_REFRESH_DELTA = 0.06; // solo re-posiciona markers HTML, no el pilar
// Por debajo de esto no dibujamos la columna 3D (el "pilar" octagonal).
const COLUMN_HIDE_ALT = 0.88;

function threatCaptureSignature() {
  return [...threatCaptureCounts().entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, n]) => `${id}:${n}`)
    .join("|");
}

function refreshThreatLayersIfNeeded({ force = false } = {}) {
  const sig = threatCaptureSignature();
  const pillarsVisible = currentCamAlt > COLUMN_HIDE_ALT;
  const captureChanged = sig !== lastThreatCaptureSig;
  const visibilityChanged = pillarsVisible !== pillarsWereVisible;
  if (!force && !captureChanged && !visibilityChanged) return;
  lastThreatCaptureSig = sig;
  pillarsWereVisible = pillarsVisible;
  refreshThreatLayers();
}

function updateThreatMarkerScale() {
  const pov = globe.pointOfView();
  const alt = pov?.altitude ?? 2.5;
  currentCamAlt = alt;

  // Escala: más grande en general; al acercarse domina la imagen (sin pilar).
  let scale;
  if (alt > 2.5) scale = 0.9;
  else if (alt > 1.0) scale = 0.9 + (1 - (alt - 1.0) / 1.5) * 0.85;   // → 1.75
  else if (alt > 0.4) scale = 1.75 + (1 - (alt - 0.4) / 0.6) * 1.5;   // → 3.25
  else if (alt > 0.15) scale = 3.25 + (1 - (alt - 0.15) / 0.25) * 2.2; // → 5.45
  else scale = 5.45 + (1 - alt / 0.15) * 3.5;                           // → 8.95
  document.documentElement.style.setProperty(
    "--threat-marker-scale",
    scale.toFixed(2)
  );

  // Glow: siempre leve. En zoom cercano un mínimo para separar del mapa.
  const HALO_MIN = 0.2;
  const HALO_MAX = 0.5;
  let haloStrength;
  if (alt <= COLUMN_HIDE_ALT) haloStrength = HALO_MIN;
  else if (alt >= 1.8) haloStrength = HALO_MAX;
  else {
    const t = (alt - COLUMN_HIDE_ALT) / (1.8 - COLUMN_HIDE_ALT);
    haloStrength = HALO_MIN + t * (HALO_MAX - HALO_MIN);
  }
  document.documentElement.style.setProperty(
    "--threat-halo-strength",
    haloStrength.toFixed(2)
  );
  let planeScale = 1;
  if (alt <= 0.12) planeScale = 2.8;
  else if (alt <= 0.3) planeScale = 2.1;
  else if (alt <= COLUMN_HIDE_ALT) planeScale = 1.6;
  document.documentElement.style.setProperty(
    "--plane-marker-scale",
    planeScale.toFixed(2)
  );
  document.body.classList.toggle("threat-zoom-close", alt <= COLUMN_HIDE_ALT);

  // Solo los markers HTML bajan con el zoom; el pilar mantiene altura fija.
  if (Math.abs(alt - lastRefreshedAlt) > ALT_REFRESH_DELTA) {
    lastRefreshedAlt = alt;
    const pillarsVisible = alt > COLUMN_HIDE_ALT;
    const visibilityChanged = pillarsVisible !== pillarsWereVisible;
    queueMicrotask(() => {
      if (!threatLayersReady) return;
      if (visibilityChanged) refreshThreatLayersIfNeeded({ force: true });
      else globe.htmlElementsData(getAllHtmlElementsData());
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
  else if (currentCamAlt <= COLUMN_HIDE_ALT) mix = 1;
  else mix = (2.0 - currentCamAlt) / 1.7;
  return topAlt * (1 - mix) + surface * mix;
}

/** Separa el marcador del avión del icono de la amenaza cuando el tractor los junta. */
function spreadPlaneBesideThreat(lat, lon, threatId, icao) {
  const threat = THREATS[threatId];
  const info = threatMgr.getAttackInfo(icao);
  if (!threat || !info || (info.pullT || 0) < 0.04) return { lat, lon };

  let dLat = lat - threat.lat;
  let dLon = lon - threat.lon;
  let dist = Math.hypot(dLat, dLon);
  const minDeg = 0.14 + (info.pullT || 0) * 0.22;

  if (dist >= minDeg) return { lat, lon };

  const ac = info.ac;
  dLat = (ac?.lat ?? lat) - threat.lat;
  dLon = (ac?.lon ?? lon) - threat.lon;
  dist = Math.hypot(dLat, dLon);
  if (dist < 0.001) {
    dLat = 0.16;
    dLon = 0.1;
    dist = Math.hypot(dLat, dLon);
  }
  const scale = minDeg / dist;
  return {
    lat: Math.max(-85, Math.min(85, threat.lat + dLat * scale)),
    lon: threat.lon + dLon * scale,
  };
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
  gameStarted: false,
};

let rescueTransmitTimer = null;
let rescueTransmitAnim = null;

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
  btnDetailFly: document.getElementById("btn-detail-fly"),
  rescueHint: document.getElementById("rescue-hint"),
  rescueCoords: document.getElementById("rescue-coords"),
  rescueCoordsText: document.getElementById("rescue-coords-text"),
  rescueStatus: document.getElementById("rescue-status"),
  sosPanel: document.getElementById("sos-panel"),
  sosList: document.getElementById("sos-list"),
  introOverlay: document.getElementById("intro-overlay"),
  introStart: document.getElementById("intro-start"),
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

/**
 * Corrige el encuadre según zoom y paneles HUD (offset chico al acercarse).
 * panel: "right" = detalle avión a la derecha; "left" = detalle amenaza.
 */
function hudFrameOffsets(camAltitude, { panel = "right" } = {}) {
  const mobile = window.matchMedia("(max-width: 900px)").matches;
  const alt = camAltitude ?? currentCamAlt ?? 2.5;
  let lat;
  let lng;
  if (alt <= 0.18) {
    lat = mobile ? 0.045 : 0.07;
    lng = mobile ? 0.035 : 0.055;
  } else if (alt <= 0.4) {
    lat = mobile ? 0.14 : 0.2;
    lng = mobile ? 0.1 : 0.16;
  } else if (alt <= 1.0) {
    lat = mobile ? 0.5 : 0.75;
    lng = mobile ? 0.38 : 0.58;
  } else {
    lat = mobile ? 1.6 : 2.6;
    lng = mobile ? 1.1 : 1.8;
  }
  const lngSign = panel === "left" ? -1 : 1;
  return { latOffset: lat, lngOffset: lngSign * lng };
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

/** Centro de cámara para ver un avión (posición visual si está bajo tractor). */
function aircraftViewTarget(icao) {
  const ac = aircraftMgr.getById(icao);
  if (!ac) return null;
  const pos = threatMgr.getDisplayPosition(icao) || { lat: ac.lat, lon: ac.lon };
  if (pos.lat == null || pos.lon == null) return null;
  const info = threatMgr.getAttackInfo(icao);
  const spread = info
    ? spreadPlaneBesideThreat(pos.lat, pos.lon, info.threatId, icao)
    : pos;
  const altitude = 0.13;
  const { latOffset, lngOffset } = hudFrameOffsets(altitude, { panel: "right" });
  return {
    lat: Math.max(-85, Math.min(85, spread.lat - latOffset)),
    lng: spread.lon + lngOffset,
    altitude,
  };
}

function flyToAircraft(icao, { animate = true } = {}) {
  const target = aircraftViewTarget(icao);
  if (!target) return;
  pauseAutoRotateForView();
  globe.pointOfView(target, animate ? 1400 : 0);
}

/** Mantiene el avión en cuadro (solo si el jugador no arrastró el mapa). */
function updateFollowCamera() {
  if (!followState.active || followState.userPaused || !followState.icao) return;
  if (!threatMgr.isUnderAttack(followState.icao)) return;
  const target = aircraftViewTarget(followState.icao);
  if (!target) return;
  globe.pointOfView(target, 0);
}

/** Centro de cámara para ver una amenaza (offset para no taparla con el panel). */
function threatViewTarget(threatId) {
  const t = THREATS[threatId];
  if (!t) return null;
  const altitude = Math.max(0.12, Math.min(0.17, t.radius_km / 6_000));
  const { latOffset, lngOffset } = hudFrameOffsets(altitude, {
    panel: hud.threatDetail?.classList.contains("hidden") ? "right" : "left",
  });

  const captured = threatMgr
    .attackedList()
    .filter((i) => i.threatId === threatId)
    .sort((a, b) => a.deadlineMs - b.deadlineMs);
  if (captured.length) {
    const ac = captured[0].ac;
    const pos = threatMgr.getDisplayPosition(ac.icao) || { lat: ac.lat, lon: ac.lon };
    const spread = spreadPlaneBesideThreat(pos.lat, pos.lon, threatId, ac.icao);
    const focusLat = (t.lat + spread.lat) / 2;
    const focusLng = (t.lon + spread.lon) / 2;
    return {
      lat: Math.max(-85, Math.min(85, focusLat - latOffset * 0.5)),
      lng: focusLng + lngOffset * 0.5,
      altitude: Math.min(altitude, 0.14),
    };
  }

  return {
    lat: Math.max(-85, Math.min(85, t.lat - latOffset)),
    lng: t.lon + lngOffset,
    altitude,
  };
}

/** Vuela hacia la amenaza sin bloquear el mapa (no activa seguimiento de avión). */
function flyToThreat(threatId) {
  const target = threatViewTarget(threatId);
  if (!target) return;
  pauseAutoRotateForView();
  flyTo(target.lat, target.lng, target.altitude, 1500);
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
  icao: null,
  userPaused: false,
};

function startFollow(ac) {
  if (!ac) return;
  followState.active = true;
  followState.icao = ac.icao;
  followState.userPaused = false;
  flyToAircraft(ac.icao, { animate: true });
}

function stopFollow({ flyBack = true, restoreRotate = true } = {}) {
  if (!followState.active) return;
  followState.active = false;
  followState.icao = null;
  followState.userPaused = false;
  if (flyBack) flyToGlobe();
  if (restoreRotate) clearAutoRotatePause({ restoreNow: true });
  else clearAutoRotatePause({ restoreNow: false });
}

function selectAircraft(icao) {
  if (
    state.selectedIcao &&
    icao !== state.selectedIcao &&
    threatMgr.getAttackInfo(state.selectedIcao)?.transmitting
  ) {
    const prev = threatMgr.getAttackInfo(state.selectedIcao);
    if (prev) {
      prev.transmitting = false;
      prev.evasion = null;
    }
    clearRescueTransmitTimers();
  }
  state.selectedIcao = icao;
  aircraftMgr.setSelected(icao);
  refreshAircraftLayer();
  if (!icao) {
    hud.detail.classList.add("hidden");
    clearRescueTransmitTimers();
    refreshRescuePanel();
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
  refreshRescuePanel();

  if (threatMgr.isUnderAttack(icao)) {
    startFollow(ac);
  } else {
    if (followState.active) stopFollow({ flyBack: false, restoreRotate: false });
    pauseAutoRotateForView();
    flyToAircraft(icao, { animate: true });
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
  const rgb = hexToRgb(colorForThreat(t, threatId));
  if (rgb) {
    hud.threatDetail.style.setProperty("--tr", rgb.r);
    hud.threatDetail.style.setProperty("--tg", rgb.g);
    hud.threatDetail.style.setProperty("--tb", rgb.b);
  }
  hud.threatDetail.classList.remove("hidden");
  hud.tdFly.dataset.threatId = threatId;
  hud.tdIcon.textContent = t.icon;
  hud.tdIcon.classList.remove("has-image");
  mountThreatImage(threatId, hud.tdIcon, {
    imgClass: "td-icon-img",
    fallbackEmoji: t.icon,
  }).catch(() => {});
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
}
setInterval(refreshAttackBanner, 500);

function clearRescueTransmitTimers() {
  if (rescueTransmitTimer) clearTimeout(rescueTransmitTimer);
  if (rescueTransmitAnim) clearInterval(rescueTransmitAnim);
  rescueTransmitTimer = null;
  rescueTransmitAnim = null;
}

function refreshRescuePanel() {
  const icao = state.selectedIcao;
  const info = icao ? threatMgr.getAttackInfo(icao) : null;
  const underAttack = info && !info.rescued;

  if (!underAttack) {
    hud.btnDetailFly?.classList.add("hidden");
    hud.rescueCoords.classList.add("hidden");
    if (!info?.transmitting) {
      hud.rescueStatus.classList.add("hidden");
      hud.btnRescue.classList.remove("transmitting");
      hud.btnRescue.disabled = true;
      hud.btnRescue.textContent = "📡 ENVIAR RUTA DE EVASIÓN";
    }
    return;
  }

  hud.btnDetailFly?.classList.remove("hidden");

  if (info.transmitting) {
    hud.btnRescue.disabled = true;
    hud.btnRescue.classList.add("transmitting");
    hud.rescueCoords.classList.remove("hidden");
    if (info.evasion) {
      hud.rescueCoordsText.textContent = `${info.evasion.lat.toFixed(3)}°, ${info.evasion.lon.toFixed(3)}°`;
    }
    return;
  }

  hud.btnRescue.disabled = false;
  hud.btnRescue.classList.remove("transmitting");
  hud.btnRescue.textContent = "📡 ENVIAR RUTA DE EVASIÓN";
  hud.rescueCoords.classList.add("hidden");
  hud.rescueStatus.classList.add("hidden");
  hud.rescueHint.textContent =
    "Enviá coordenadas de evasión. El piloto debe confirmar para salir de la emergencia.";
}

async function runRescueTransmit(icao) {
  const ev = threatMgr.startRescueTransmit(icao);
  if (!ev) {
    showToast("No se pudo transmitir (cooldown o no está bajo ataque)", "warn");
    return;
  }

  clearRescueTransmitTimers();
  hud.btnRescue.disabled = true;
  hud.btnRescue.classList.add("transmitting");
  hud.rescueCoords.classList.remove("hidden");
  hud.rescueCoordsText.textContent = `${ev.lat.toFixed(3)}°, ${ev.lon.toFixed(3)}°`;
  hud.rescueStatus.classList.remove("hidden");
  hud.rescueStatus.textContent = "Transmitiendo vectores al piloto…";
  refreshAircraftLayer();

  rescueTransmitAnim = setInterval(() => {
    threatMgr.tickRescueTransmit(icao);
    refreshAircraftLayer();
  }, 120);

  rescueTransmitTimer = setTimeout(async () => {
    clearRescueTransmitTimers();
    hud.rescueStatus.textContent = "Piloto confirma. Ejecutando desvío…";
    await speakPilotAccept(ev.callsign);
    threatMgr.finishRescueTransmit(icao);
    hud.rescueStatus.textContent = "¡Vuelo liberado!";
    refreshRescuePanel();
    refreshAttackBanner();
    renderSosList();
    refreshAircraftLayer();
    setTimeout(() => {
      if (hud.rescueStatus) hud.rescueStatus.classList.add("hidden");
    }, 2500);
  }, 3200);
}

/** B2: lista SOS ordenada por urgencia (menos tiempo primero). */
function renderSosList() {
  const list = threatMgr
    .attackedList()
    .sort((a, b) => a.deadlineMs - b.deadlineMs);

  if (!list.length) {
    hud.sosPanel.classList.add("hidden");
    hud.sosList.innerHTML = "";
    return;
  }

  hud.sosPanel.classList.remove("hidden");
  hud.sosList.innerHTML = list
    .map((info) => {
      const ac = info.ac;
      const t = THREATS[info.threatId];
      const remaining = Math.max(0, Math.ceil((info.deadlineMs - Date.now()) / 1000));
      const sel = state.selectedIcao === ac.icao ? " selected" : "";
      const flag = flagFor(ac.origin_country) || "";
      return `<div class="sos-row${sel}" data-icao="${ac.icao}">
        <div>
          <span class="sos-cs">${flag} ${ac.callsign || ac.icao}</span>
          <span class="sos-threat">${t?.icon || ""} ${t?.name || info.threatId}</span>
        </div>
        <span class="sos-time">${remaining}s</span>
      </div>`;
    })
    .join("");

  hud.sosList.querySelectorAll(".sos-row").forEach((el) => {
    el.addEventListener("click", () => selectAircraft(el.dataset.icao));
  });
}

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
    .ringsData(getAllRingsData())
    .arcsData(getAttackArcsData());
}
function threatCaptureCounts() {
  return threatMgr.getCaptureCountsByThreat();
}

function refreshThreatLayers() {
  globe.pointsData(getThreatPointsForGlobe()).ringsData(getAllRingsData());
  globe.htmlElementsData(getAllHtmlElementsData());
}

/** Columnas 3D: altura y grosor fijos; visibles solo con zoom lejano/medio. */
function getThreatPointsForGlobe() {
  if (currentCamAlt <= COLUMN_HIDE_ALT) return [];
  return threatRenderer.getPointsData(threatCaptureCounts());
}

// Rings combinados: amenazas (anillos lentos amplios) + aviones bajo ataque
// (anillos rápidos rojos pequeños) + escudos de rescate (anillos verdes
// efímeros que celebran un rescate exitoso, estilo earth-shield).
function getAllRingsData() {
  return [
    ...threatRenderer.getRingsData(threatCaptureCounts()),
    ...aircraftMgr.getAttackedRingsData((icao) => threatMgr.getDisplayPosition(icao)),
    ...getRescueShieldsData(),
  ];
}

function distanceKmApprox(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Línea fina tractor beam (sin tubo 3D que parecía un "bean"). */
function getAttackArcsData() {
  const arcs = [];
  for (const info of threatMgr.attackedList()) {
    if ((info.pullT || 0) < 0.04) continue;
    const t = THREATS[info.threatId];
    const pos = threatMgr.getDisplayPosition(info.ac.icao);
    if (!t || !pos) continue;
    const dist = distanceKmApprox(pos.lat, pos.lon, t.lat, t.lon);
    if (dist < 30) continue;
    const rgb = hexToRgb(colorForThreat(t, info.threatId)) || { r: 255, g: 70, b: 90 };
    arcs.push({
      startLat: pos.lat,
      startLng: pos.lon,
      endLat: t.lat,
      endLng: t.lon,
      colors: [
        "rgba(255, 45, 70, 0.35)",
        `rgba(${rgb.r},${rgb.g},${rgb.b},0.55)`,
      ],
    });
  }
  return arcs;
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
function ringColorInterpolator(hex, alphaScale = 1) {
  const rgb = hexToRgb(hex) || { r: 255, g: 255, b: 255 };
  return (t) =>
    `rgba(${rgb.r},${rgb.g},${rgb.b},${Math.sqrt(1 - t) * alphaScale})`;
}

// Combinamos aviones + amenazas en una sola lista de htmlElements.
// Usamos un campo `__kind` para dispatcher al element builder correcto.
// Las amenazas usan altitude dinámica: alto en vista global, descienden
// hasta cerca de la superficie cuando el jugador hace zoom in.
function getAllHtmlElementsData() {
  const threats = threatRenderer
    .getHtmlElementsData(threatCaptureCounts())
    .map((d) => ({
      ...d,
      alt: threatMarkerAltitude(d.alt),
      __kind: "threat",
    }));
  const planes = aircraftMgr.getHtmlElementsData().map((d) => {
    const info = threatMgr.getAttackInfo(d.icao);
    const pos = threatMgr.getDisplayPosition(d.icao) || { lat: d.lat, lon: d.lng };
    const spread = info
      ? spreadPlaneBesideThreat(pos.lat, pos.lon, info.threatId, d.icao)
      : pos;
    let alt = d.alt;
    if (info && !info.rescued) {
      alt = Math.max(alt, threatMarkerAltitude(0.07) + 0.012);
    }
    return {
      ...d,
      lat: spread.lat,
      lng: spread.lon,
      alt,
      __kind: "plane",
    };
  });
  // Amenazas primero, aviones encima (si no, el icono tapa al avión capturado).
  return [...threats, ...planes];
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
  .pointResolution(12)
  .pointsData([])

  // Anillos pulsantes (amenazas, aviones bajo ataque y escudos de rescate)
  .ringLat("lat")
  .ringLng("lng")
  .ringAltitude((d) => d.altitude || 0)
  .ringMaxRadius("maxR")
  .ringPropagationSpeed("propagationSpeed")
  .ringRepeatPeriod("repeatPeriod")
  .ringColor((d) =>
    ringColorInterpolator(
      d.color,
      d.threatId != null
        ? d.isCapturing
          ? 0.58
          : 0.42
        : d.kind === "shield"
          ? 0.7
          : 0.85
    )
  )
  .ringsData([])

  // Tractor beam: línea 1px punteada (arcStroke null = sin tubo volumétrico)
  .arcStartLat("startLat")
  .arcStartLng("startLng")
  .arcEndLat("endLat")
  .arcEndLng("endLng")
  .arcColor((d) => d.colors)
  .arcAltitude(0.012)
  .arcStroke(null)
  .arcDashLength(0.5)
  .arcDashGap(0.35)
  .arcDashAnimateTime(2200)
  .arcsData([])

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
        const c = colorForThreat(t, t.id);
        return `<div class="threat-row${active}" data-threat="${t.id}" style="--threat-row-color:${c}">
          <span class="threat-icon-small" data-threat-id="${t.id}">${t.icon}</span>
          <span class="threat-name">${t.name}</span>
          <span class="threat-power">★${t.power}</span>
        </div>`;
      })
      .join("");
    html += "</div>";
  }
  hud.threatsList.innerHTML = html;
  hud.threatsList.querySelectorAll(".threat-icon-small[data-threat-id]").forEach(
    (el) => {
      const id = el.dataset.threatId;
      const threat = THREATS[id];
      mountThreatImage(id, el, {
        imgClass: "threat-row-img",
        fallbackEmoji: threat?.icon,
      }).catch(() => {});
    }
  );
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
      refreshThreatLayersIfNeeded({ force: true });
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
  renderSosList();
  refreshThreatLayersIfNeeded();
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
    renderSosList();
    if (isMobileLayout()) {
      document.querySelector('.hud-tabs .tab[data-tab="traffic"]')?.click();
    }
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
    renderSosList();
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
  if (!state.gameStarted) return;
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
  renderSosList();
  refreshAircraftLayer();
  refreshThreatLayersIfNeeded();
  updateFollowCamera();
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
  if (!state.gameStarted) return;
  threatMgr.tick();
  aircraftMgr.setAttackedIcaos(threatMgr.attackedList().map((i) => i.ac.icao));
  refreshAttackBanner();
  renderSosList();
  refreshAircraftLayer();
  refreshThreatLayersIfNeeded();
  updateFollowCamera();
}, 1000);

// ── Botones de acción ────────────────────────────────────────────────────────
hud.btnDetailFly?.addEventListener("click", () => {
  const ac = state.selectedIcao ? aircraftMgr.getById(state.selectedIcao) : null;
  if (ac && threatMgr.isUnderAttack(ac.icao)) startFollow(ac);
});

hud.btnRescue.addEventListener("click", () => {
  if (!state.selectedIcao) return;
  const info = threatMgr.getAttackInfo(state.selectedIcao);
  if (!info || info.rescued || info.transmitting) return;
  runRescueTransmit(state.selectedIcao);
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
  refreshThreatLayersIfNeeded({ force: true });
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
  refreshThreatLayersIfNeeded({ force: true });
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
  markCameraActivity();
  controls.autoRotate = !controls.autoRotate;
  btnRotate.classList.toggle("active-rotate", controls.autoRotate);
  if (controls.autoRotate) {
    clearAutoRotatePause({ restoreNow: false });
    autoRotateIdle.prevAutoRotate = true;
  } else {
    clearAutoRotatePause({ restoreNow: false });
    autoRotateIdle.prevAutoRotate = false;
  }
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

// ── Passthrough de pointer: rotate / zoom / pan siempre al canvas ───────────
// globe.gl superpone una capa HTML (CSS2D) a pantalla completa. Si esa capa
// o los markers capturan eventos, OrbitControls no recibe wheel ni drag — ni
// siquiera en "huecos" entre aviones. Forzamos pointer-events:none en overlays
// y resolvemos taps/clicks con hit-test manual (mouse + touch unificado).

const isTouchDevice =
  "ontouchstart" in window ||
  (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
  window.matchMedia("(pointer: coarse)").matches;
if (isTouchDevice) document.body.classList.add("is-touch");

function configureGlobePointerPassthrough() {
  const canvas = container.querySelector("canvas");
  if (canvas) canvas.style.pointerEvents = "auto";
  for (const child of container.children) {
    if (child.tagName === "DIV") child.style.pointerEvents = "none";
  }
  container.querySelectorAll(".plane-marker, .threat-marker").forEach((el) => {
    el.style.pointerEvents = "none";
  });
}

configureGlobePointerPassthrough();
setTimeout(configureGlobePointerPassthrough, 100);
setTimeout(configureGlobePointerPassthrough, 500);
let globePePending = false;
function scheduleGlobePointerPassthrough() {
  if (globePePending) return;
  globePePending = true;
  requestAnimationFrame(() => {
    globePePending = false;
    configureGlobePointerPassthrough();
  });
}
const globePeObserver = new MutationObserver(scheduleGlobePointerPassthrough);
globePeObserver.observe(container, { childList: true, subtree: true });

const TAP_MAX_DURATION_MS = 350;
const TAP_MAX_MOVE_PX = 14;
let tapPointerId = null;
let tapStartX = 0;
let tapStartY = 0;
let tapStartT = 0;
let tapMoved = false;

function markerHitAt(clientX, clientY, selector, pad = 0) {
  const markers = container.querySelectorAll(selector);
  for (let i = markers.length - 1; i >= 0; i--) {
    const r = markers[i].getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (
      clientX >= r.left - pad &&
      clientX <= r.right + pad &&
      clientY >= r.top - pad &&
      clientY <= r.bottom + pad
    ) {
      return markers[i];
    }
  }
  return null;
}

function dispatchMarkerTapAt(clientX, clientY) {
  const pad = isTouchDevice ? 14 : 8;
  const plane = markerHitAt(clientX, clientY, ".plane-marker", pad);
  const threat =
    plane || markerHitAt(clientX, clientY, ".threat-marker", 0);
  if (!threat) return;
  threat.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
    })
  );
}

function resetTapState() {
  tapPointerId = null;
  tapMoved = false;
}

container.addEventListener(
  "pointerdown",
  (e) => {
    if (e.button !== 0) return;
    markCameraActivity();
    tapPointerId = e.pointerId;
    tapStartX = e.clientX;
    tapStartY = e.clientY;
    tapStartT = Date.now();
    tapMoved = false;
  },
  { passive: true }
);

container.addEventListener(
  "pointermove",
  (e) => {
    if (e.pointerId !== tapPointerId) return;
    if (
      Math.hypot(e.clientX - tapStartX, e.clientY - tapStartY) > TAP_MAX_MOVE_PX
    ) {
      tapMoved = true;
      if (followState.active) followState.userPaused = true;
    }
  },
  { passive: true }
);

container.addEventListener(
  "pointerup",
  (e) => {
    if (e.pointerId !== tapPointerId) return;
    const wasTap =
      !tapMoved && Date.now() - tapStartT <= TAP_MAX_DURATION_MS;
    resetTapState();
    if (!wasTap) return;
    dispatchMarkerTapAt(e.clientX, e.clientY);
  },
  { passive: true }
);

container.addEventListener("pointercancel", resetTapState);

// ── Tutorial / inicio de misión ──────────────────────────────────────────────
function startGame() {
  if (state.gameStarted) return;
  state.gameStarted = true;
  hud.introOverlay?.classList.add("hidden");
  activateAllThreats(null, { silent: true });
  hud.aviones.textContent = "0";
  restartPollLoop();
  showToast("Misión iniciada. Salvá a las aeronaves bajo ataque.", "ok");
  appendComms({
    type: "MISSION",
    msg: "🎮 MISIÓN INICIADA — Rescatá aviones antes de que las amenazas los capturen.",
    t: new Date(),
  });
}

hud.introStart?.addEventListener("click", () => {
  const ctx = window.AudioContext || window.webkitAudioContext;
  if (ctx) new ctx().resume?.();
  if (window.speechSynthesis) window.speechSynthesis.getVoices();
  startGame();
});

// ── Boot ─────────────────────────────────────────────────────────────────────
flyToGlobe();
threatLayersReady = true;
refreshThreatLayers();

setOnThreatImageReady(() => {
  if (threatLayersReady) refreshThreatLayersIfNeeded({ force: true });
  renderThreatsList();
});

preloadThreatImages([
  "area_51",
  "roswell",
  "uritorco",
  "nazca",
  "stonehenge",
  "nessie",
  "chupacabra",
  "kraken",
  "yeti",
  "bigfoot",
  "mothman",
  "godzilla",
  "cthulhu",
]);

console.log("[paranormal-hunt] init OK", {
  preset: state.preset?.label,
  threatsAvailable: Object.keys(THREATS).length,
  threatsActive: threatMgr.activeThreats.size,
});
