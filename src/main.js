// Bootstrap del juego "Paranormal Hunt".
// Stack: Vite + CesiumJS + módulos JS nativos.

import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import { fetchAircraft } from "./opensky.js";
import { PRESETS, REGIONES } from "./presets.js";
import { AircraftManager } from "./aircraft.js";
import { AirportsManager } from "./airports.js";
import { CinemaMode } from "./cinema.js";
import { flagFor } from "./flags.js";
import { IMAGERY_PROVIDERS, setBaseLayer } from "./imagery.js";
import { THREATS, THREAT_CATEGORIES } from "./threats.js";
import { ThreatManager } from "./threatManager.js";
import { ThreatRenderer } from "./threatRender.js";
import { Simulator } from "./simulator.js";
import {
  playAttackSound,
  playRescueSound,
  playLostSound,
  playGameOverSound,
  setMuted,
  isMuted,
} from "./audio.js";

// ── Cesium Ion token ─────────────────────────────────────────────────────────
const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
const useIon =
  ionToken &&
  ionToken.length > 60 &&
  !ionToken.includes("dummy") &&
  !ionToken.includes("pegar_aqui");

if (useIon) {
  Cesium.Ion.defaultAccessToken = ionToken;
}

// ── Viewer ───────────────────────────────────────────────────────────────────
const viewerOptions = {
  animation: false,
  timeline: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  baseLayerPicker: false,
  navigationHelpButton: false,
  fullscreenButton: false,
  infoBox: false,
  selectionIndicator: false,
  shadows: false,
  shouldAnimate: true,
};

// Default: TOPO (OpenTopoMap) — tiles livianos, vista con relieve, sin token.
viewerOptions.baseLayer = new Cesium.ImageryLayer(
  IMAGERY_PROVIDERS.TOPO.create(),
);
if (!useIon) {
  viewerOptions.terrainProvider = new Cesium.EllipsoidTerrainProvider();
}

const viewer = new Cesium.Viewer("cesiumContainer", viewerOptions);
let currentImageryKey = "TOPO";

viewer.scene.skyAtmosphere.show = true;
viewer.scene.fog.enabled = true;
viewer.scene.fog.density = 5e-5;
viewer.scene.globe.enableLighting = true;
viewer.scene.globe.depthTestAgainstTerrain = false;

if (useIon) {
  try {
    const terrain = await Cesium.createWorldTerrainAsync({
      requestVertexNormals: true,
      requestWaterMask: true,
    });
    viewer.scene.terrainProvider = terrain;
  } catch (err) {
    console.warn("[cesium] terreno Ion no disponible", err);
  }
}

// ── Estado de la app ─────────────────────────────────────────────────────────
const state = {
  preset: PRESETS.AEP,
  presetKey: "AEP",
  selectedIcao: null,
  pollIntervalMs: 10_000,
  simIntervalMs: 1_500, // refresh más rápido en modo SIM (no consume API)
  lastAircraftList: [],
  mode: "SIM", // "SIM" | "LIVE"
};

const aircraftManager = new AircraftManager(viewer);
const airportsManager = new AirportsManager(viewer);
const threatMgr = new ThreatManager(viewer);
const cinema = new CinemaMode(viewer, aircraftManager, threatMgr);
const threatRenderer = new ThreatRenderer(viewer);
const simulator = new Simulator(80);

// Cuando el chase/cinema se activa, deshabilitar el rescate por proximidad
// para que la cámara pueda estar cerca del avión sin rescatarlo solo.
cinema.callbacks.onActiveChange = (active) => {
  threatMgr.setProximityRescueEnabled(!active);
};

// ── Cámara ───────────────────────────────────────────────────────────────────
function flyToPreset(presetKey, options = {}) {
  const preset = PRESETS[presetKey];
  if (!preset) return;
  state.preset = preset;
  state.presetKey = presetKey;

  if (cinema.active) {
    cinema.stop();
    document.getElementById("btn-cinema").classList.remove("active");
  }

  document.getElementById("hud-title").textContent = preset.label.toUpperCase();
  document.getElementById("hud-region").textContent = preset.region;

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      preset.lon,
      preset.lat - (preset.height < 200_000 ? 0.45 : 5),
      preset.height,
    ),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(preset.height < 200_000 ? -35 : -75),
      roll: 0,
    },
    duration: options.duration ?? 2.0,
    complete: () => viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY),
  });

  airportsManager.showInBbox(preset.bbox);

  document.querySelectorAll(".preset-row").forEach((el) => {
    el.classList.toggle("active", el.dataset.preset === presetKey);
  });

  pollOnce();
}

/**
 * Vista "Rubik's cube": cámara fija a media distancia mirando al centro
 * de la Tierra, sin pistas de aeropuerto, lista para arrastrar y rotar.
 */
function flyToGlobe(options = {}) {
  if (cinema.active) {
    cinema.stop();
    document.getElementById("btn-cinema").classList.remove("active");
  }
  state.presetKey = "GLOBE";
  airportsManager.hideAll?.();

  document.getElementById("hud-title").textContent = "VISTA GLOBAL";
  document.getElementById("hud-region").textContent = "🌍 Mundo";

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(0, 15, 24_000_000),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-90),
      roll: 0,
    },
    duration: options.duration ?? 2.0,
    complete: () => {
      // Al llegar al globo, dejamos al usuario rotar libremente.
      // Cesium hace `lookAt` por default; lo desactivamos para liberar la cámara.
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    },
  });

  document
    .querySelectorAll(".preset-row")
    .forEach((el) => el.classList.remove("active"));

  pollOnce();
}

// Configuración de controles para que se sienta como manipular un cubo de Rubik:
// arrastrar = rotar el globo, rueda = zoom, click derecho = inclinar.
const sscc = viewer.scene.screenSpaceCameraController;
sscc.enableTilt = true;
sscc.enableRotate = true;
sscc.enableZoom = true;
sscc.enableLook = false;
// Limitar zoom para que no nos clave en el suelo ni nos mande al espacio profundo.
sscc.minimumZoomDistance = 100_000;
sscc.maximumZoomDistance = 60_000_000;

// Arranque en modo globo.
flyToGlobe({ duration: 0 });

// ── HUD: refs ────────────────────────────────────────────────────────────────
const hud = {
  aviones: document.getElementById("stat-aviones"),
  attacked: document.getElementById("stat-attacked"),
  api: document.getElementById("stat-api"),
  utc: document.getElementById("stat-utc"),
  score: document.getElementById("stat-score"),
  lives: document.getElementById("stat-lives"),
  rescued: document.getElementById("stat-rescued"),
  lost: document.getElementById("stat-lost"),
  list: document.getElementById("aircraft-list"),
  presetsList: document.getElementById("presets-list"),
  threatsList: document.getElementById("threats-list"),
  commsLog: document.getElementById("comms-log"),
  toastStack: document.getElementById("toast-stack"),
  detail: document.getElementById("hud-detail"),
  detailCallsign: document.getElementById("detail-callsign"),
  detailIcao: document.getElementById("detail-icao"),
  detailFL: document.getElementById("detail-fl"),
  detailVel: document.getElementById("detail-vel"),
  detailHdg: document.getElementById("detail-hdg"),
  detailVario: document.getElementById("detail-vario"),
  detailOrig: document.getElementById("detail-orig"),
  detailClose: document.getElementById("detail-close"),
  attackBanner: document.getElementById("attack-banner"),
  attackTitle: document.getElementById("attack-title"),
  attackSource: document.getElementById("attack-source"),
  attackIcon: document.getElementById("attack-icon"),
  timerFill: document.getElementById("timer-fill"),
  timerText: document.getElementById("timer-text"),
  btnFlyTo: document.getElementById("btn-fly-to"),
  btnChase: document.getElementById("btn-chase"),
  btnRescue: document.getElementById("btn-rescue"),
  rescueHint: document.getElementById("rescue-hint"),
  // Panel detalle amenaza
  threatDetail: document.getElementById("threat-detail"),
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
  threatDetailClose: document.getElementById("threat-detail-close"),
};

// ── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll(".hud-tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const which = tab.dataset.tab;
    document
      .querySelectorAll(".hud-tabs .tab")
      .forEach((t) => t.classList.toggle("active", t === tab));
    document
      .querySelectorAll(".tab-content")
      .forEach((c) => c.classList.toggle("active", c.dataset.tab === which));
  });
});

// ── Renderizar lista de presets ──────────────────────────────────────────────
function renderPresets() {
  let html = "";
  for (const [region, keys] of Object.entries(REGIONES)) {
    html += `<div class="presets-region">${region.toUpperCase()}</div>`;
    for (const key of keys) {
      const p = PRESETS[key];
      html += `<div class="preset-row" data-preset="${key}">
        <span class="icao">${p.icao}</span>
        <span class="label">${p.label}</span>
      </div>`;
    }
  }
  hud.presetsList.innerHTML = html;
  hud.presetsList.querySelectorAll(".preset-row").forEach((el) => {
    el.addEventListener("click", () => flyToPreset(el.dataset.preset));
  });
}
renderPresets();

// ── Renderizar lista de amenazas ─────────────────────────────────────────────
function renderThreats() {
  const grouped = { ufo: [], paranormal: [], creature: [] };
  for (const [id, t] of Object.entries(THREATS)) {
    grouped[t.category].push({ id, ...t });
  }

  let html = "";
  for (const [cat, list] of Object.entries(grouped)) {
    const meta = THREAT_CATEGORIES[cat];
    html += `<div class="threat-cat-header" style="color:${meta.color}">
      <span>${meta.icon} ${meta.label}</span>
      <span>${list.length}</span>
    </div>`;
    for (const t of list) {
      const stars = "★".repeat(t.power) + "☆".repeat(5 - t.power);
      html += `<div class="threat-row" data-threat="${t.id}" data-color="${t.color}">
        <div class="threat-icon">${t.icon}</div>
        <div class="threat-info">
          <div class="threat-name">${t.name}</div>
          <div class="threat-region">${t.region}</div>
          <div class="threat-power">${stars} · ${t.radius_km} km</div>
        </div>
      </div>`;
    }
  }
  hud.threatsList.innerHTML = html;
  hud.threatsList.querySelectorAll(".threat-row").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.threat;
      threatMgr.toggleThreat(id);
      el.classList.toggle("active", threatMgr.isActive(id));
      threatRenderer.syncWithActive([...threatMgr.activeThreats.keys()]);
    });
  });
}
renderThreats();

// ── Switcher de imagery ──────────────────────────────────────────────────────
function renderImagerySwitcher() {
  const container = document.getElementById("imagery-switcher");
  container.innerHTML = Object.entries(IMAGERY_PROVIDERS)
    .map(
      ([key, p]) =>
        `<button class="imagery-btn ${
          key === currentImageryKey ? "active" : ""
        }" data-img="${key}" title="${p.name}">${p.label}</button>`,
    )
    .join("");
  container.querySelectorAll(".imagery-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.img;
      setBaseLayer(viewer, key);
      currentImageryKey = key;
      container
        .querySelectorAll(".imagery-btn")
        .forEach((b) => b.classList.toggle("active", b === btn));
    });
  });
}
renderImagerySwitcher();

// ── Reloj UTC ────────────────────────────────────────────────────────────────
function tickClock() {
  hud.utc.textContent = new Date().toISOString().substring(11, 19);
}
tickClock();
setInterval(tickClock, 1000);

// ── Lista de aviones ─────────────────────────────────────────────────────────
function renderAircraftList(aircraft) {
  if (aircraft.length === 0) {
    hud.list.innerHTML = '<div class="empty">Sin tráfico en el área…</div>';
    return;
  }
  aircraft.sort((a, b) => a.callsign.localeCompare(b.callsign));
  hud.list.innerHTML = aircraft
    .map((ac) => {
      const fl = ac.geo_alt
        ? "FL" + Math.round(ac.geo_alt / 30.48).toString().padStart(3, "0")
        : "GND";
      const sel = state.selectedIcao === ac.icao ? "selected" : "";
      const att = threatMgr.isUnderAttack(ac.icao) ? "attacked" : "";
      const flag = flagFor(ac.country);
      return `<div class="aircraft-row ${sel} ${att}" data-icao="${ac.icao}">
        <span class="callsign"><span class="row-flag">${flag}</span> ${ac.callsign}${
          att ? " ⚠️" : ""
        }</span>
        <span class="alt">${fl}</span>
      </div>`;
    })
    .join("");
  hud.list.querySelectorAll(".aircraft-row").forEach((el) => {
    el.addEventListener("click", () => {
      const ac = aircraft.find((a) => a.icao === el.dataset.icao);
      if (ac) selectAircraft(ac);
    });
  });
}

// ── Selección de avión ──────────────────────────────────────────────────────
function selectAircraft(ac) {
  state.selectedIcao = ac.icao;
  aircraftManager.highlight(ac.icao);

  const flag = flagFor(ac.country);
  hud.detailCallsign.innerHTML = `<span class="detail-flag">${flag}</span> ${ac.callsign}`;
  hud.detailIcao.textContent = ac.icao?.toUpperCase() || "--";
  hud.detailFL.textContent = ac.geo_alt
    ? "FL" + Math.round(ac.geo_alt / 30.48).toString().padStart(3, "0")
    : "GND";
  hud.detailVel.textContent = ac.velocity
    ? Math.round(ac.velocity * 1.94384) + " kt"
    : "--";
  hud.detailHdg.textContent =
    ac.heading != null ? Math.round(ac.heading) + "°" : "--";
  hud.detailVario.textContent =
    ac.vertical_rate != null
      ? (ac.vertical_rate >= 0 ? "+" : "") +
        Math.round(ac.vertical_rate * 196.85) +
        " fpm"
      : "--";
  hud.detailOrig.innerHTML = `${flag} ${ac.country || "--"}`;
  hud.detail.classList.remove("hidden");

  document
    .querySelectorAll(".aircraft-row")
    .forEach((el) => el.classList.remove("selected"));
  document
    .querySelector(`.aircraft-row[data-icao="${ac.icao}"]`)
    ?.classList.add("selected");

  // Si hay un chase activo y se cambió de avión, parar el chase anterior.
  // Si está en modo cinema (auto-cycle), también se para porque interfiere.
  if (cinema.active && !cinema.isChasing(ac.icao)) {
    cinema.stop();
    document.getElementById("btn-cinema").classList.remove("active");
    hud.btnChase.classList.remove("active");
  }

  refreshAttackBanner();
}

hud.detailClose.addEventListener("click", () => {
  state.selectedIcao = null;
  hud.detail.classList.add("hidden");
  aircraftManager.highlight(null);
  document
    .querySelectorAll(".aircraft-row")
    .forEach((el) => el.classList.remove("selected"));
  if (cinema.active) {
    cinema.stop();
    hud.btnChase.classList.remove("active");
  }
});

// Click en avión 3D / amenaza → seleccionar y mostrar info
viewer.screenSpaceEventHandler.setInputAction((click) => {
  const picked = viewer.scene.pick(click.position);
  if (!Cesium.defined(picked)) return;

  const props = picked.id?.properties;
  if (!props) return;

  if (props.ac) {
    selectAircraft(props.ac.getValue());
    return;
  }
  if (props.threatId) {
    showThreatDetail(props.threatId.getValue());
  }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// ── Panel detalle de amenaza ─────────────────────────────────────────────────
function hexToRgb(hex) {
  const m = hex.replace("#", "").trim();
  const full =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  const num = parseInt(full, 16);
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

function showThreatDetail(threatId) {
  const t = THREATS[threatId];
  if (!t) return;

  hud.tdIcon.textContent = t.icon;
  hud.tdName.textContent = t.name;
  hud.tdRegion.textContent = t.region;
  hud.tdDesc.textContent = t.desc;

  const catMeta = THREAT_CATEGORIES[t.category];
  hud.tdCategory.textContent = catMeta?.label ?? t.category.toUpperCase();
  hud.tdPower.textContent = "★".repeat(t.power) + "☆".repeat(5 - t.power);
  hud.tdRadius.textContent = `${t.radius_km} km`;
  hud.tdLat.textContent = t.lat.toFixed(4) + "°";
  hud.tdLon.textContent = t.lon.toFixed(4) + "°";

  const isActive = threatMgr.isActive(threatId);
  hud.tdStatus.textContent = isActive ? "🔴 ACTIVA" : "⚫ INACTIVA";
  hud.tdStatus.style.color = isActive ? "#ff4477" : "#88aaa0";

  hud.tdFly.dataset.threatId = threatId;

  // Tinta el panel con el color de la amenaza vía CSS custom props.
  const { r, g, b } = hexToRgb(t.color);
  hud.threatDetail.style.setProperty("--tr", r);
  hud.threatDetail.style.setProperty("--tg", g);
  hud.threatDetail.style.setProperty("--tb", b);

  hud.threatDetail.classList.remove("hidden");
}

hud.threatDetailClose.addEventListener("click", () => {
  hud.threatDetail.classList.add("hidden");
});

hud.tdFly.addEventListener("click", () => {
  const id = hud.tdFly.dataset.threatId;
  const t = THREATS[id];
  if (!t) return;
  if (cinema.active) {
    cinema.stop();
    document.getElementById("btn-cinema").classList.remove("active");
  }

  // flyToBoundingSphere encuadra el target dentro del frustum de la cámara,
  // dejándolo centrado horizontal y verticalmente sin offsets manuales.
  // El radio de la esfera se basa en el radio de efecto + el alto del beam
  // para que entren TODOS los elementos 3D de la amenaza.
  const beamHeight = 60_000 + (t.power || 1) * 40_000;
  const sphereRadius = Math.max(t.radius_km * 1000 * 1.4, beamHeight * 0.7);
  const center = Cesium.Cartesian3.fromDegrees(t.lon, t.lat, beamHeight / 2);
  const sphere = new Cesium.BoundingSphere(center, sphereRadius);

  viewer.camera.flyToBoundingSphere(sphere, {
    duration: 2.0,
    offset: new Cesium.HeadingPitchRange(
      0,
      Cesium.Math.toRadians(-35),
      sphereRadius * 3.0,
    ),
    complete: () => {
      // Liberamos la cámara del lookAt automático que mete flyToBoundingSphere
      // así el usuario puede volver a girar el globo libremente con el mouse.
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    },
  });
});

// ── Banner de ataque + acciones ──────────────────────────────────────────────
function refreshAttackBanner() {
  const icao = state.selectedIcao;
  if (!icao) {
    hud.attackBanner.classList.add("hidden");
    hud.btnRescue.disabled = true;
    return;
  }
  const info = threatMgr.getAttackInfo(icao);
  if (!info || info.rescued) {
    hud.attackBanner.classList.add("hidden");
    hud.btnRescue.disabled = true;
    hud.rescueHint.textContent = "Avión sin amenaza activa.";
    return;
  }
  const t = THREATS[info.threatId];
  hud.attackBanner.classList.remove("hidden");
  hud.attackIcon.textContent = t?.icon || "⚠️";
  hud.attackTitle.textContent = "BAJO ATAQUE";
  hud.attackSource.textContent = t ? `${t.name} (${t.region})` : "Desconocido";
  hud.btnRescue.disabled = false;

  const remainingMs = info.deadlineMs - Date.now();
  const totalMs = info.deadlineMs - info.startedAt;
  const pct = Math.max(0, Math.min(100, (remainingMs / totalMs) * 100));
  hud.timerFill.style.width = `${pct}%`;
  hud.timerText.textContent = Math.max(0, Math.round(remainingMs / 1000)) + "s";
}

// Refresh banner cada segundo
setInterval(refreshAttackBanner, 500);

hud.btnFlyTo.addEventListener("click", () => {
  if (!state.selectedIcao) return;
  const entity = aircraftManager.getById(state.selectedIcao);
  if (entity) {
    viewer
      .flyTo(entity, {
        duration: 1.5,
        offset: new Cesium.HeadingPitchRange(
          0,
          Cesium.Math.toRadians(-20),
          15_000,
        ),
      })
      .then(() => viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY))
      .catch(() => {});
  }
});

// Toggle chase camera (vista persecución cercana, tipo videojuego).
hud.btnChase.addEventListener("click", () => {
  if (!state.selectedIcao) return;
  if (cinema.isChasing(state.selectedIcao)) {
    cinema.stop();
    hud.btnChase.classList.remove("active");
    document.getElementById("btn-cinema").classList.remove("active");
  } else {
    cinema.chaseAircraft(state.selectedIcao);
    hud.btnChase.classList.add("active");
    document.getElementById("btn-cinema").classList.remove("active");
  }
});

hud.btnRescue.addEventListener("click", () => {
  if (!state.selectedIcao) return;
  threatMgr.manualRescue(state.selectedIcao);
});

// ── Buttons inferiores ───────────────────────────────────────────────────────
document.getElementById("btn-globe").addEventListener("click", flyToGlobe);

/**
 * "Centrar": preserva la altitud actual pero recentra la cámara mirando
 * perpendicular al suelo y libera el lookAtTransform. Útil cuando la cámara
 * quedó "rara" después de un flyTo a una amenaza o un avión.
 */
function centerCamera() {
  if (cinema.active) {
    cinema.stop();
    document.getElementById("btn-cinema").classList.remove("active");
    hud.btnChase.classList.remove("active");
  }
  // Reset transform primero para que la posición sea coherente
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);

  const cart = viewer.camera.positionCartographic;
  const lon = cart ? Cesium.Math.toDegrees(cart.longitude) : 0;
  const lat = cart ? Cesium.Math.toDegrees(cart.latitude) : 15;
  const height = cart ? cart.height : 24_000_000;

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-90),
      roll: 0,
    },
    duration: 1.0,
    complete: () => viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY),
  });
}

document.getElementById("btn-center").addEventListener("click", centerCamera);
document.getElementById("btn-reset").addEventListener("click", () =>
  flyToPreset(state.presetKey),
);
document.getElementById("btn-cinema").addEventListener("click", () => {
  const isActive = cinema.toggle();
  document.getElementById("btn-cinema").classList.toggle("active", isActive);
});
// ── Activación masiva de amenazas ────────────────────────────────────────────
function activateAllThreats(filter = null, { silent = true } = {}) {
  let count = 0;
  for (const [id, t] of Object.entries(THREATS)) {
    if (filter && t.category !== filter) continue;
    if (!threatMgr.isActive(id)) {
      threatMgr.toggleThreat(id, { silent });
      count++;
    }
  }
  syncThreatUI();
  return count;
}

function deactivateAllThreats() {
  for (const id of [...threatMgr.activeThreats.keys()]) {
    threatMgr.toggleThreat(id, { silent: true });
  }
  syncThreatUI();
}

function syncThreatUI() {
  threatRenderer.syncWithActive([...threatMgr.activeThreats.keys()]);
  document.querySelectorAll(".threat-row").forEach((el) => {
    el.classList.toggle("active", threatMgr.isActive(el.dataset.threat));
  });
}

document
  .getElementById("btn-clear-threats")
  .addEventListener("click", deactivateAllThreats);

document
  .getElementById("btn-all-threats")
  .addEventListener("click", () => activateAllThreats());

document
  .getElementById("threats-all-on")
  .addEventListener("click", () => activateAllThreats());

document
  .getElementById("threats-all-off")
  .addEventListener("click", deactivateAllThreats);

document.querySelectorAll(".threats-btn.cat").forEach((btn) => {
  btn.addEventListener("click", () => activateAllThreats(btn.dataset.cat));
});

// Toggle mute de sonidos
const btnMute = document.getElementById("btn-mute");
btnMute.addEventListener("click", () => {
  setMuted(!isMuted());
  btnMute.textContent = isMuted() ? "🔇" : "🔊";
  btnMute.title = isMuted() ? "Activar sonidos" : "Silenciar sonidos";
});

const btnMode = document.getElementById("btn-mode");
function refreshModeButton() {
  if (state.mode === "SIM") {
    btnMode.textContent = "🎮 SIM";
    btnMode.classList.remove("active");
  } else {
    btnMode.textContent = "📡 LIVE";
    btnMode.classList.add("active");
  }
}
btnMode.addEventListener("click", () => {
  state.mode = state.mode === "SIM" ? "LIVE" : "SIM";
  refreshModeButton();
  // Limpiar entities cuando cambia el modo
  aircraftManager.clearAll?.();
  restartPollLoop();
});
refreshModeButton();

// ── ThreatManager callbacks ──────────────────────────────────────────────────
threatMgr.callbacks.onState = (s) => {
  hud.score.textContent = s.score;
  hud.lives.textContent =
    "❤".repeat(s.lives) + "♡".repeat(Math.max(0, 3 - s.lives));
  hud.rescued.textContent = s.rescued;
  hud.lost.textContent = s.lost;
  hud.attacked.textContent = s.attackedCount;
};

// Throttle de sonido de ataque: con SIM y muchas amenazas activas se podrían
// disparar varios eventos por segundo; limitamos a 1 sonido cada 1.2s.
let lastAttackSoundAt = 0;

threatMgr.callbacks.onEvent = (ev) => {
  showToast(ev);
  appendComms(ev);

  switch (ev.type) {
    case "AIRCRAFT_ATTACK": {
      const now = Date.now();
      if (now - lastAttackSoundAt > 1200) {
        playAttackSound();
        lastAttackSoundAt = now;
      }
      break;
    }
    case "RESCUE_OK":
      playRescueSound();
      break;
    case "LOST":
      playLostSound();
      break;
    case "GAME_OVER":
      playGameOverSound();
      break;
  }
};

function showToast(ev) {
  let cls = "info";
  if (ev.type === "RESCUE_OK") cls = "success";
  else if (ev.type === "LOST" || ev.type === "GAME_OVER") cls = "danger";
  else if (ev.type === "ATTACK" || ev.type === "AIRCRAFT_ATTACK")
    cls = "warning";

  const div = document.createElement("div");
  div.className = `toast ${cls}`;
  div.textContent = ev.msg;
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

// ── Loop de polling (SIM o LIVE) ─────────────────────────────────────────────
async function pollOnce() {
  let aircraft;
  if (state.mode === "SIM") {
    // Mostrar TODOS los aviones del simulador (no filtrar por bbox)
    aircraft = simulator.getAircraft();
    hud.api.textContent = "SIM";
    hud.api.style.color = "#ffaa00";
  } else {
    const result = await fetchAircraft(state.preset.bbox);
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
  aircraftManager.upsert(aircraft);
  threatMgr.updateAttacks(aircraft);
  aircraftManager.setAttackedIcaos(
    threatMgr.attackedList().map((i) => i.ac.icao),
  );
  hud.aviones.textContent = aircraftManager.count();
  renderAircraftList(aircraft);
}

let pollHandle = null;
function restartPollLoop() {
  if (pollHandle) clearInterval(pollHandle);
  pollOnce();
  const ms = state.mode === "SIM" ? state.simIntervalMs : state.pollIntervalMs;
  pollHandle = setInterval(pollOnce, ms);
}
restartPollLoop();

// Tick más rápido para timers de rescate y proximidad de cámara (1 Hz)
setInterval(() => {
  threatMgr.tick();
  aircraftManager.setAttackedIcaos(
    threatMgr.attackedList().map((i) => i.ac.icao),
  );
}, 1000);

// Encender todas las amenazas por default — el caos paranormal arranca activo.
activateAllThreats();

console.log("[paranormal-hunt] init OK", {
  preset: state.preset.label,
  threatsAvailable: Object.keys(THREATS).length,
  threatsActive: threatMgr.activeThreats.size,
});
