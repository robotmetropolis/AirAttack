// Manejo de entities Cesium para los aviones.
// Cada avión es un entity con position + model 3D + label + path histórico
// + vector proyectado hacia adelante (por dónde va a ir).

import * as Cesium from "cesium";
import { flagFor } from "./flags.js";
import { iconForCategory } from "./planeIcons.js";

// Cuántos segundos hacia adelante proyectamos el vector (línea futura)
const VECTOR_FUTURE_SECONDS = 6 * 60; // 6 minutos
// Mínima velocidad para dibujar el vector (m/s)
const MIN_VELOCITY_FOR_VECTOR = 30;

// Categorías ADS-B que devuelve OpenSky en el campo 17 con extended=1.
const CATEGORIA_TIPO = {
  0: "unknown",
  1: "unknown",
  2: "light", // < 15 500 lbs
  3: "small", // 15 500 - 75 000 lbs
  4: "large", // 75 000 - 300 000 lbs
  5: "high_vortex",
  6: "heavy", // > 300 000 lbs
  7: "high_perf",
  8: "rotor",
  10: "glider",
  11: "balloon",
  12: "ultralight",
  14: "uav",
  15: "space",
};

const COLOR_POR_TIPO = {
  unknown: Cesium.Color.fromCssColorString("#00ff7f"),
  light: Cesium.Color.fromCssColorString("#9bf06a"),
  small: Cesium.Color.fromCssColorString("#5ddc55"),
  large: Cesium.Color.fromCssColorString("#3aa0ff"),
  high_vortex: Cesium.Color.fromCssColorString("#ff8c1a"),
  heavy: Cesium.Color.fromCssColorString("#ff4040"),
  high_perf: Cesium.Color.fromCssColorString("#ffaa00"),
  rotor: Cesium.Color.fromCssColorString("#bb55ff"),
  glider: Cesium.Color.fromCssColorString("#cccccc"),
  balloon: Cesium.Color.fromCssColorString("#ffffff"),
  ultralight: Cesium.Color.fromCssColorString("#aaffaa"),
  uav: Cesium.Color.fromCssColorString("#888888"),
  space: Cesium.Color.fromCssColorString("#ff00ff"),
};

// Escala de modelo por tipo (en metros aprox.)
// minimumPixelSize asegura que sea visible aún a gran zoom-out.
const ESCALA_POR_TIPO = {
  unknown: { scale: 1.0, minPixelSize: 32 },
  light: { scale: 0.6, minPixelSize: 24 },
  small: { scale: 0.8, minPixelSize: 28 },
  large: { scale: 1.0, minPixelSize: 36 },
  high_vortex: { scale: 1.4, minPixelSize: 40 },
  heavy: { scale: 1.6, minPixelSize: 48 },
  high_perf: { scale: 0.9, minPixelSize: 32 },
  rotor: { scale: 0.5, minPixelSize: 24 },
  glider: { scale: 0.7, minPixelSize: 24 },
  balloon: { scale: 0.5, minPixelSize: 24 },
  ultralight: { scale: 0.4, minPixelSize: 20 },
  uav: { scale: 0.3, minPixelSize: 18 },
  space: { scale: 1.5, minPixelSize: 40 },
};

const MODEL_URI = "/models/cesium_air.glb";

function tipoDe(categoria) {
  return CATEGORIA_TIPO[categoria] || "unknown";
}

function colorDe(categoria) {
  return COLOR_POR_TIPO[tipoDe(categoria)] || COLOR_POR_TIPO.unknown;
}

function escalaDe(categoria) {
  return ESCALA_POR_TIPO[tipoDe(categoria)] || ESCALA_POR_TIPO.unknown;
}

/**
 * Proyecta una posición lineal hacia adelante usando heading + velocity.
 * Devuelve [lon, lat, alt] del punto futuro a `seconds` adelante.
 * Aproximación lineal en grados (válida para distancias < ~500 km).
 */
function projectForward(lat, lon, alt, headingDeg, velocityMs, secondsAhead) {
  const distance = velocityMs * secondsAhead; // metros
  const headingRad = Cesium.Math.toRadians(headingDeg);
  const distLat = (distance * Math.cos(headingRad)) / 111_000;
  const distLon =
    (distance * Math.sin(headingRad)) /
    (111_000 * Math.cos(Cesium.Math.toRadians(lat)));
  return [lon + distLon, lat + distLat, alt];
}

/**
 * Calcula HeadingPitchRoll a partir de heading (grados, 0=N), velocity (m/s)
 * y vertical_rate (m/s). El roll lo dejamos en 0; podríamos calcular banking
 * si hubiera información de turn rate, pero no la tenemos.
 */
function calcularHPR(heading, velocity, verticalRate) {
  const headingRad =
    heading != null ? Cesium.Math.toRadians(heading - 90) : 0;
  // -90 porque el modelo glb apunta a +X (este local). Si lo ponemos a 0,
  // el avión queda mirando al este; restando 90 alineamos con el norte
  // como sentido de heading=0.
  let pitchRad = 0;
  if (velocity && velocity > 5 && verticalRate != null) {
    pitchRad = Math.atan2(verticalRate, velocity);
    // Limitar pitch a ±20° para evitar pitch absurdo cuando velocity es bajo
    pitchRad = Math.max(-0.35, Math.min(0.35, pitchRad));
  }
  return new Cesium.HeadingPitchRoll(headingRad, pitchRad, 0);
}

// Color de alarma para aviones bajo ataque
const ATTACK_COLOR = Cesium.Color.fromCssColorString("#ff2222");

/**
 * Manager de entities aviones.
 * Mantiene un map icao -> entity para hacer updates eficientes.
 */
export class AircraftManager {
  constructor(viewer) {
    this.viewer = viewer;
    this.entities = new Map(); // icao -> Cesium.Entity
    this.history = new Map(); // icao -> [{lon,lat,alt,t}, ...]
    this.maxHistory = 60; // últimos N puntos para el trail
    this.attackedIcaos = new Set(); // aviones actualmente bajo ataque
  }

  /**
   * Sincroniza el estado bajo-ataque de los aviones. Recibe un Set de ICAOs
   * que actualmente están bajo ataque.
   */
  setAttackedIcaos(icaos) {
    this.attackedIcaos = new Set(icaos);
    for (const [icao, entity] of this.entities.entries()) {
      this._applyAttackVisual(entity, icao);
    }
  }

  _applyAttackVisual(entity, icao) {
    const ac = entity.properties?.ac?.getValue();
    if (!ac) return;
    const baseColor = colorDe(ac.category);
    const isAttacked = this.attackedIcaos.has(icao);
    const color = isAttacked ? ATTACK_COLOR : baseColor;

    if (entity.label) {
      entity.label.fillColor = color;
      entity.label.outlineWidth = isAttacked ? 4 : 2;
    }
    if (entity.point) entity.point.color = color;
    if (entity.model) {
      entity.model.color = color;
      entity.model.silhouetteColor = color;
      entity.model.silhouetteSize = isAttacked ? 4.5 : 1.5;
    }
    // Mostrar/ocultar anillo de alarma
    if (entity._attackRing) {
      entity._attackRing.show = isAttacked;
    }
  }

  upsert(aircraft) {
    const seen = new Set();

    for (const ac of aircraft) {
      seen.add(ac.icao);
      const altitude = ac.geo_alt ?? ac.baro_alt ?? 0;
      const position = Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, altitude);
      const color = colorDe(ac.category);
      const escala = escalaDe(ac.category);
      const tipo = tipoDe(ac.category);
      const hpr = calcularHPR(ac.heading, ac.velocity, ac.vertical_rate);
      const orientation = Cesium.Transforms.headingPitchRollQuaternion(
        position,
        hpr,
      );

      // Histórico para trail
      const hist = this.history.get(ac.icao) || [];
      hist.push({ lon: ac.lon, lat: ac.lat, alt: altitude, t: Date.now() });
      if (hist.length > this.maxHistory) hist.shift();
      this.history.set(ac.icao, hist);

      const flag = flagFor(ac.country);
      const labelText = `${flag} ${ac.callsign}`;

      let entity = this.entities.get(ac.icao);
      if (!entity) {
        // Trail polyline (positions se actualiza luego con CallbackProperty)
        const trailPositions = new Cesium.CallbackProperty(() => {
          const h = this.history.get(ac.icao) || [];
          return h.map((p) =>
            Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt),
          );
        }, false);

        // Vector futuro (proyección hacia adelante). Se recalcula on-the-fly
        // a partir del último estado del avión.
        const futurePositions = new Cesium.CallbackProperty(() => {
          const acNow = entity?.properties?.ac?.getValue();
          if (
            !acNow ||
            !acNow.heading ||
            !acNow.velocity ||
            acNow.velocity < MIN_VELOCITY_FOR_VECTOR ||
            acNow.on_ground
          ) {
            return [];
          }
          const altNow = acNow.geo_alt ?? acNow.baro_alt ?? 0;
          // Generamos varios puntos para tener una línea suave. Si hubiese
          // vertical_rate, podemos hacer una pendiente aproximada.
          const segments = 4;
          const result = [
            Cesium.Cartesian3.fromDegrees(acNow.lon, acNow.lat, altNow),
          ];
          for (let i = 1; i <= segments; i++) {
            const t = (VECTOR_FUTURE_SECONDS * i) / segments;
            const [flon, flat] = projectForward(
              acNow.lat,
              acNow.lon,
              altNow,
              acNow.heading,
              acNow.velocity,
              t,
            );
            const falt =
              acNow.vertical_rate != null
                ? Math.max(0, altNow + acNow.vertical_rate * t)
                : altNow;
            result.push(Cesium.Cartesian3.fromDegrees(flon, flat, falt));
          }
          return result;
        }, false);

        entity = this.viewer.entities.add({
          id: ac.icao,
          name: ac.callsign,
          position,
          orientation,
          properties: {
            heading: ac.heading,
            ac,
          },
          model: {
            uri: MODEL_URI,
            scale: escala.scale,
            minimumPixelSize: escala.minPixelSize,
            maximumScale: 200,
            silhouetteColor: color,
            silhouetteSize: 1.5,
            color, // tinta el modelo en el color de su categoría
            colorBlendMode: Cesium.ColorBlendMode.MIX,
            colorBlendAmount: 0.45,
            // El modelo glb apunta a +X. La orientación lo rota al heading correcto.
          },
          // Billboard SVG: silueta de la categoría, rotada según heading.
          // Reemplaza al punto-circular: ahora el avión se ve como avión
          // (o helicóptero, planeador, drone, etc.) desde el globo.
          billboard: {
            image: iconForCategory(tipo),
            color, // tinta blanco→color de categoría (multiplicación)
            scale: 0.45,
            rotation:
              ac.heading != null ? -Cesium.Math.toRadians(ac.heading) : 0,
            scaleByDistance: new Cesium.NearFarScalar(
              1.5e6,
              0.6,
              4.0e7,
              1.1,
            ),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
              500_000.0,
              Number.MAX_VALUE,
            ),
            disableDepthTestDistance: 1_500_000,
          },
          label: {
            text: labelText,
            font: "11px monospace",
            fillColor: color,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -32),
            disableDepthTestDistance: 1_500_000,
            scaleByDistance: new Cesium.NearFarScalar(1.0e3, 1.0, 5.0e6, 0.0),
          },
          polyline: {
            positions: trailPositions,
            width: 2,
            material: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.18,
              taperPower: 0.5,
              color,
            }),
            clampToGround: false,
          },
        });

        // Vector futuro: línea punteada hacia donde va el avión.
        // Solo se muestra en zoom cercano (zone view), oculto en globo
        // para no saturar la vista con muchas líneas amarillas.
        const vectorEntity = this.viewer.entities.add({
          id: `${ac.icao}_vec`,
          polyline: {
            positions: futurePositions,
            width: 1.5,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString("#ffaa00").withAlpha(0.7),
              dashLength: 16.0,
            }),
            clampToGround: false,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
              0,
              1_500_000,
            ),
          },
        });

        // Anillo de alarma pulsante (oculto por default).
        // Usamos `time` (JulianDate del frame, idéntico para ambas llamadas)
        // para que semiMajorAxis === semiMinorAxis siempre y Cesium no falle.
        const ringPhase = (time) => {
          const sec = Cesium.JulianDate.toDate(time).getTime() / 1000;
          return (sec % 1.5) / 1.5; // 0..1 con período de 1.5s
        };
        const ringRadius = (time) => 800 + ringPhase(time) * 4000;
        const attackRing = this.viewer.entities.add({
          id: `${ac.icao}_attack`,
          position: new Cesium.CallbackProperty(
            (time, result) => entity.position?.getValue(time, result),
            false,
          ),
          show: false,
          ellipse: {
            semiMajorAxis: new Cesium.CallbackProperty(
              (time) => ringRadius(time),
              false,
            ),
            semiMinorAxis: new Cesium.CallbackProperty(
              (time) => ringRadius(time),
              false,
            ),
            material: new Cesium.ColorMaterialProperty(
              new Cesium.CallbackProperty(
                (time) => ATTACK_COLOR.withAlpha(0.4 * (1 - ringPhase(time))),
                false,
              ),
            ),
            outline: true,
            outlineColor: ATTACK_COLOR.withAlpha(0.8),
            heightReference: Cesium.HeightReference.NONE,
            height: 0,
          },
        });

        // Asociamos las entities auxiliares al entity principal para limpiarlas juntas
        entity._auxEntities = [vectorEntity, attackRing];
        entity._attackRing = attackRing;

        this.entities.set(ac.icao, entity);
      } else {
        entity.position = position;
        entity.orientation = orientation;
        entity.properties.heading = ac.heading;
        entity.properties.ac = ac;
        entity.label.text = labelText;
        if (entity.billboard && ac.heading != null) {
          entity.billboard.rotation = -Cesium.Math.toRadians(ac.heading);
        }
      }

      // Aplicar visual de ataque (rojo pulsante o color normal)
      const e = this.entities.get(ac.icao);
      if (e) this._applyAttackVisual(e, ac.icao);
    }

    // Borrar aviones que no se ven hace > 60s.
    const now = Date.now();
    for (const [icao, entity] of this.entities.entries()) {
      if (!seen.has(icao)) {
        const hist = this.history.get(icao);
        const lastSeen = hist?.[hist.length - 1]?.t || 0;
        if (now - lastSeen > 60_000) {
          this.viewer.entities.remove(entity);
          if (entity._auxEntities) {
            for (const aux of entity._auxEntities) {
              this.viewer.entities.remove(aux);
            }
          }
          this.entities.delete(icao);
          this.history.delete(icao);
        }
      }
    }
  }

  /**
   * Elimina todas las entities y limpia la historia. Útil al cambiar SIM↔LIVE.
   */
  clearAll() {
    for (const [, entity] of this.entities.entries()) {
      this.viewer.entities.remove(entity);
      if (entity._auxEntities) {
        for (const aux of entity._auxEntities) {
          this.viewer.entities.remove(aux);
        }
      }
    }
    this.entities.clear();
    this.history.clear();
    this.attackedIcaos.clear();
  }

  count() {
    return this.entities.size;
  }

  getById(icao) {
    return this.entities.get(icao);
  }

  highlight(icao) {
    for (const [id, entity] of this.entities.entries()) {
      const sel = id === icao;
      if (entity.label) {
        entity.label.scale = sel ? 1.4 : 1.0;
        entity.label.outlineWidth = sel ? 4 : 2;
      }
      if (entity.model) {
        entity.model.silhouetteSize = sel ? 3.0 : 1.5;
      }
    }
  }
}
