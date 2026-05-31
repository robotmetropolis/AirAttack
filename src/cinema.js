// Modo cinematográfico mejorado: "chase camera" lateral / casi a nivel.
// Se mete en preRender y reposiciona la cámara cada frame para mantenerla
// pegada al avión seleccionado, con un offset relativo al heading del avión.
// Cada N segundos cambia de target y de estilo.

import * as Cesium from "cesium";
import { THREATS } from "./threats.js";

// Estilos de cámara: cómo posicionarla relativo al avión.
//   angle:    grados desde el rumbo (0=trás, 90=derecha, 180=adelante, 270=izq)
//   distance: distancia horizontal en metros desde el avión
//   height:   offset vertical en metros (positivo = arriba del avión)
const CAMERA_STYLES = [
  // Vista lateral derecha "a nivel" (clásica de aerolíneas)
  { name: "side-right-level", angle: 90, distance: 250, height: 15 },
  // Vista lateral izquierda
  { name: "side-left-level", angle: -90, distance: 250, height: 15 },
  // Vista trasera baja, casi como tail-cam
  { name: "tail-low", angle: 0, distance: 350, height: 10 },
  // Vista trasera elevada (típica de simulador)
  { name: "tail-high", angle: 0, distance: 500, height: 80 },
  // Vista frontal pasante (avión viene hacia la cámara)
  { name: "head-on", angle: 180, distance: 600, height: 30 },
  // Vista 3/4 trasera derecha (cinemática)
  { name: "rear-quarter-right", angle: 45, distance: 350, height: 60 },
  // Vista 3/4 trasera izquierda
  { name: "rear-quarter-left", angle: -45, distance: 350, height: 60 },
  // Vista 3/4 frontal derecha
  { name: "front-quarter-right", angle: 135, distance: 400, height: 40 },
];

// Vista persecución panorámica: detrás y arriba del avión, suficiente
// distancia para que la amenaza que lo está atacando entre en cuadro.
// Cuando el avión NO está bajo ataque se usan estos defaults; cuando sí
// está bajo ataque la distancia/altura se ajustan al radio de la amenaza.
const CHASE_STYLE = {
  name: "chase-wide",
  angle: 0, // detrás del avión
  distance: 3_000, // 3 km por detrás
  height: 1_200, // 1.2 km por encima
};

export class CinemaMode {
  constructor(viewer, manager, threatMgr = null) {
    this.viewer = viewer;
    this.manager = manager;
    this.threatMgr = threatMgr; // opcional, para auto-ajustar distancia
    this.active = false;
    this.timer = null;
    this.currentIcao = null;
    this.currentStyle = null;
    this.intervalMs = 14_000; // cambio de target cada 14s

    this._preRenderFn = null;
    this.callbacks = {
      // Llamado al cambiar entre activo/inactivo. main.js lo usa para
      // desactivar el rescate por proximidad mientras hay chase activo.
      onActiveChange: null,
    };
  }

  _setActive(active) {
    if (this.active === active) return;
    this.active = active;
    this.callbacks.onActiveChange?.(active);
  }

  start() {
    if (this.active) return;
    this._setActive(true);
    this._next();
    this.timer = setInterval(() => this._next(), this.intervalMs);

    this._preRenderFn = () => this._updateCamera();
    this.viewer.scene.preRender.addEventListener(this._preRenderFn);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this._preRenderFn) {
      this.viewer.scene.preRender.removeEventListener(this._preRenderFn);
      this._preRenderFn = null;
    }
    this.viewer.trackedEntity = undefined;
    this.currentIcao = null;
    this.currentStyle = null;
    this._setActive(false);
  }

  toggle() {
    if (this.active) this.stop();
    else this.start();
    return this.active;
  }

  /**
   * Activa una persecución panorámica sobre un avión específico,
   * sin auto-ciclar a otros aviones. Cámara atrás y arriba del avión.
   * La distancia/altura se ajustan dinámicamente si el avión está bajo
   * ataque, para que la amenaza también entre en cuadro.
   */
  chaseAircraft(icao) {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.currentIcao = icao;
    this.currentStyle = CHASE_STYLE;
    if (!this._preRenderFn) {
      this._preRenderFn = () => this._updateCamera();
      this.viewer.scene.preRender.addEventListener(this._preRenderFn);
    }
    this._setActive(true);
    console.log(`[cinema] CHASE locked on ${icao}`);
  }

  isChasing(icao) {
    return this.active && this.currentIcao === icao && !this.timer;
  }

  _next() {
    if (!this.active) return;
    const candidates = [...this.manager.entities.entries()]
      .filter(([icao]) => icao !== this.currentIcao)
      .filter(([, entity]) => {
        const ac = entity.properties?.ac?.getValue();
        if (!ac) return false;
        if (ac.on_ground) return false;
        if (!ac.geo_alt || ac.geo_alt < 500) return false;
        if (!ac.velocity || ac.velocity < 50) return false;
        if (ac.heading == null) return false;
        return true;
      });

    if (candidates.length === 0) {
      console.log("[cinema] sin candidatos, esperando…");
      return;
    }

    // Pseudo-random sesgado a aviones grandes (heavy=6, large=4, vortex=5)
    const score = candidates.map(([, e]) => {
      const ac = e.properties.ac.getValue();
      const cat = ac.category || 0;
      return cat === 6 ? 6 : cat === 4 ? 4 : cat === 5 ? 3 : 1;
    });
    const totalW = score.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalW;
    let idx = 0;
    for (let i = 0; i < score.length; i++) {
      r -= score[i];
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    const [icao] = candidates[idx];
    this.currentIcao = icao;
    this.currentStyle =
      CAMERA_STYLES[Math.floor(Math.random() * CAMERA_STYLES.length)];

    console.log(
      `[cinema] target=${icao} style=${this.currentStyle.name}`,
    );
  }

  _updateCamera() {
    if (!this.active || !this.currentIcao || !this.currentStyle) return;
    const entity = this.manager.entities.get(this.currentIcao);
    if (!entity) {
      // Avión desapareció, pasar al siguiente
      this._next();
      return;
    }

    const time = this.viewer.clock.currentTime;
    const position = entity.position?.getValue(time);
    if (!position) return;

    const acProp = entity.properties?.ac?.getValue();
    if (!acProp || acProp.heading == null) return;
    const heading = acProp.heading;

    let style = this.currentStyle;

    // Modo chase: si el avión está bajo ataque, expandimos la distancia/altura
    // proporcionalmente al radio de la amenaza para que entre en cuadro.
    if (style.name === "chase-wide" && this.threatMgr) {
      const info = this.threatMgr.getAttackInfo(this.currentIcao);
      if (info && !info.rescued) {
        const t = THREATS[info.threatId];
        if (t) {
          const r_m = t.radius_km * 1000;
          // Distancia ≈ 30% del radio, mín 3 km, máx 50 km
          const dynDist = Math.min(Math.max(r_m * 0.3, 3_000), 50_000);
          // Altura ≈ 40% de la distancia
          const dynHeight = dynDist * 0.4;
          style = { ...style, distance: dynDist, height: dynHeight };
        }
      }
    }

    // Calcular el offset en frame ENU (East-North-Up) local al avión.
    // angle se mide desde el RUMBO del avión (0 = trás, 90 = derecha).
    // Convertimos eso a un heading absoluto y de ahí a un vector E/N.
    const offsetHeadingDeg = (heading + 180 + style.angle) % 360;
    const offsetHeadingRad = Cesium.Math.toRadians(offsetHeadingDeg);
    const eastOffset = style.distance * Math.sin(offsetHeadingRad);
    const northOffset = style.distance * Math.cos(offsetHeadingRad);
    const upOffset = style.height;

    // Transformación ENU → ECEF en la posición del avión
    const enuTransform = Cesium.Transforms.eastNorthUpToFixedFrame(position);
    const localOffset = new Cesium.Cartesian3(
      eastOffset,
      northOffset,
      upOffset,
    );
    const cameraPos = Cesium.Matrix4.multiplyByPoint(
      enuTransform,
      localOffset,
      new Cesium.Cartesian3(),
    );

    // Vector de la cámara hacia el avión
    const direction = Cesium.Cartesian3.subtract(
      position,
      cameraPos,
      new Cesium.Cartesian3(),
    );
    Cesium.Cartesian3.normalize(direction, direction);

    // "Up" planetario en la posición de la cámara (vector radial hacia afuera)
    const up = Cesium.Cartesian3.normalize(
      cameraPos,
      new Cesium.Cartesian3(),
    );

    this.viewer.camera.setView({
      destination: cameraPos,
      orientation: { direction, up },
    });
  }
}
