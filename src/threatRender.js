// Render de amenazas en el viewer Cesium.
// - Halo (área de efecto) en superficie
// - Pilar de luz vertical altísimo (visible desde el espacio)
// - Marker billboard (círculo + emoji renderizado en canvas) y nombre
//
// Cada entity guarda `properties.threatId` para que el click handler en main.js
// pueda recuperar la amenaza clickeada.

import * as Cesium from "cesium";
import { THREATS } from "./threats.js";

// Cache de imágenes generadas (forma + emoji por threat).
// Se renderiza al canvas HTML para esquivar el bug de Cesium Label que dibuja
// cuadrados negros cuando la fuente emoji no resuelve dentro del canvas
// interno del Label widget.
const ICON_CACHE = new Map();

// Convierte un hex CSS a [r, g, b]
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
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
}

// Dibuja un polígono regular (hexágono, triángulo, diamante, etc.).
function drawPolygon(ctx, cx, cy, r, sides, rotationRad = 0) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + rotationRad - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// Forma por categoría: { sides, rotation, name }
const CATEGORY_SHAPE = {
  ufo: { sides: 6, rotation: 0 }, // hexágono (sci-fi techno)
  paranormal: { sides: 4, rotation: Math.PI / 4 }, // diamante (místico)
  creature: { sides: 3, rotation: 0 }, // triángulo (alerta)
};

/**
 * Genera el icono de una amenaza:
 *   - shape específica por categoría (hexágono / diamante / triángulo)
 *   - gradiente radial del color
 *   - glow externo
 *   - aro interno con highlight
 *   - emoji grande centrado
 */
function makeIconImage(emoji, cssColor, category, size = 128) {
  const key = `${emoji}_${cssColor}_${category}_${size}`;
  if (ICON_CACHE.has(key)) return ICON_CACHE.get(key);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 10;
  const rInner = rOuter * 0.78;

  const [r, g, b] = hexToRgb(cssColor);
  const shape = CATEGORY_SHAPE[category] || CATEGORY_SHAPE.ufo;

  // Glow externo (sombra del primer trazo)
  ctx.save();
  ctx.shadowColor = cssColor;
  ctx.shadowBlur = 18;
  ctx.fillStyle = `rgba(${r},${g},${b},0.95)`;
  drawPolygon(ctx, cx, cy, rOuter, shape.sides, shape.rotation);
  ctx.fill();
  ctx.restore();

  // Cuerpo con gradiente radial (centro brillante → borde oscuro)
  const grad = ctx.createRadialGradient(cx, cy - rOuter * 0.2, 0, cx, cy, rOuter);
  grad.addColorStop(0, `rgba(${Math.min(r + 80, 255)},${Math.min(g + 80, 255)},${Math.min(b + 80, 255)},1)`);
  grad.addColorStop(0.5, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(1, `rgba(${Math.floor(r * 0.35)},${Math.floor(g * 0.35)},${Math.floor(b * 0.35)},1)`);
  drawPolygon(ctx, cx, cy, rOuter, shape.sides, shape.rotation);
  ctx.fillStyle = grad;
  ctx.fill();

  // Borde blanco grueso
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.stroke();

  // Aro interno (highlight de "scan")
  drawPolygon(ctx, cx, cy, rInner, shape.sides, shape.rotation);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.stroke();

  // Emoji
  ctx.font = `${Math.floor(size * 0.48)}px 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 4;
  ctx.fillText(emoji, cx, cy + 4);

  const dataUrl = canvas.toDataURL("image/png");
  ICON_CACHE.set(key, dataUrl);
  return dataUrl;
}

/**
 * Crea la "parte de abajo" (beam) — la forma 3D que conecta el suelo
 * con la geometría del cielo. Distinta por categoría para que cada
 * tipo de amenaza tenga una silueta característica.
 *
 *  - ufo       → tractor beam delgado vertical
 *  - paranormal→ tornado/vórtice escalonado (cilindros apilados)
 *  - creature  → montaña base muy ancha (pirámide invertida)
 */
function createBeam(viewer, t, color, beamHeight, id) {
  const radiusM = t.radius_km * 1000;
  const baseRadius = Math.min(radiusM * 0.3, 30_000);

  switch (t.category) {
    case "ufo": {
      // Tractor beam: cilindro casi recto, angosto, transparente.
      const tractor = viewer.entities.add({
        id: `threat_beam_${id}`,
        position: Cesium.Cartesian3.fromDegrees(t.lon, t.lat, beamHeight / 2),
        properties: { threatId: id },
        cylinder: {
          length: beamHeight,
          topRadius: 4_000,
          bottomRadius: 2_500,
          material: color.withAlpha(0.22),
          outline: true,
          outlineColor: color.withAlpha(0.95),
        },
      });
      // Disco/spotlight en el suelo (como una huella de aterrizaje)
      const pad = viewer.entities.add({
        id: `threat_beam_${id}_pad`,
        position: Cesium.Cartesian3.fromDegrees(t.lon, t.lat, 100),
        properties: { threatId: id },
        ellipse: {
          semiMajorAxis: 8_000,
          semiMinorAxis: 8_000,
          material: color.withAlpha(0.5),
          outline: true,
          outlineColor: color.withAlpha(1.0),
          outlineWidth: 4,
          height: 100,
          extrudedHeight: 800,
        },
      });
      return [tractor, pad];
    }

    case "paranormal": {
      // Vórtice/tornado: 4 cilindros apilados que se van angostando hacia arriba
      const layers = [];
      const sectionH = beamHeight / 4;
      for (let i = 0; i < 4; i++) {
        const bottomR = baseRadius * (1 - i * 0.18);
        const topR = baseRadius * (1 - (i + 1) * 0.18);
        const yPos = sectionH * (i + 0.5);
        const cyl = viewer.entities.add({
          id: `threat_beam_${id}_layer_${i}`,
          position: Cesium.Cartesian3.fromDegrees(t.lon, t.lat, yPos),
          properties: { threatId: id },
          cylinder: {
            length: sectionH,
            topRadius: Math.max(topR, 1_500),
            bottomRadius: Math.max(bottomR, 2_000),
            material: color.withAlpha(0.28 + i * 0.04),
            outline: true,
            outlineColor: color.withAlpha(0.9),
          },
        });
        layers.push(cyl);
      }
      return layers;
    }

    case "creature": {
      // Montaña/lair: pirámide ancha en la base que se angosta arriba.
      // Muy distintiva — la criatura "vive" dentro de su madriguera gigante.
      const mountainHeight = beamHeight * 0.55;
      const skyHeight = beamHeight - mountainHeight;
      const mountain = viewer.entities.add({
        id: `threat_beam_${id}`,
        position: Cesium.Cartesian3.fromDegrees(
          t.lon,
          t.lat,
          mountainHeight / 2,
        ),
        properties: { threatId: id },
        cylinder: {
          length: mountainHeight,
          topRadius: 8_000,
          bottomRadius: baseRadius * 1.5,
          material: color.withAlpha(0.55),
          outline: true,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
        },
      });
      // Conexión angosta entre la montaña y la garra (cuello)
      const neck = viewer.entities.add({
        id: `threat_beam_${id}_neck`,
        position: Cesium.Cartesian3.fromDegrees(
          t.lon,
          t.lat,
          mountainHeight + skyHeight / 2,
        ),
        properties: { threatId: id },
        cylinder: {
          length: skyHeight,
          topRadius: 2_500,
          bottomRadius: 6_000,
          material: color.withAlpha(0.4),
          outline: true,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
        },
      });
      return [mountain, neck];
    }
  }

  // Fallback (no debería ocurrir)
  return [];
}

/**
 * Crea la geometría 3D característica de cada categoría de amenaza,
 * posicionada en lo alto del beam. Devuelve un array de Entities.
 *
 *  - ufo       → platillo volador (disco aplanado + cabina)
 *  - paranormal→ portal con anillos concéntricos a distintas alturas
 *  - creature  → garra/colmillo apuntando al cielo (cono invertido) + base
 */
function createSkyShape(viewer, t, color, beamHeight, id) {
  const baseAlt = beamHeight; // tope del beam
  const power = t.power || 1;
  const shapes = [];

  switch (t.category) {
    case "ufo": {
      // Disco principal del platillo
      const radius = 12_000 + power * 2_500;
      const saucer = viewer.entities.add({
        id: `threat_shape_${id}_saucer`,
        position: Cesium.Cartesian3.fromDegrees(t.lon, t.lat, baseAlt + 6_000),
        properties: { threatId: id },
        ellipsoid: {
          radii: new Cesium.Cartesian3(radius, radius, radius * 0.18),
          material: color.withAlpha(0.75),
          outline: true,
          outlineColor: Cesium.Color.WHITE.withAlpha(0.9),
        },
      });
      // Cabina semiesférica encima
      const dome = viewer.entities.add({
        id: `threat_shape_${id}_dome`,
        position: Cesium.Cartesian3.fromDegrees(t.lon, t.lat, baseAlt + 8_000),
        properties: { threatId: id },
        ellipsoid: {
          radii: new Cesium.Cartesian3(
            radius * 0.4,
            radius * 0.4,
            radius * 0.3,
          ),
          material: Cesium.Color.WHITE.withAlpha(0.6),
        },
      });
      // Tres luces giratorias debajo (puntos de colores)
      shapes.push(saucer, dome);
      break;
    }

    case "paranormal": {
      // Portal: 5 anillos concéntricos a distintas alturas, formando un vórtice
      const baseRadius = 16_000 + power * 2_000;
      for (let i = 0; i < 5; i++) {
        const ringR = baseRadius - i * 1_800;
        const ringHeight = baseAlt + i * 4_000;
        const ringEntity = viewer.entities.add({
          id: `threat_shape_${id}_ring_${i}`,
          position: Cesium.Cartesian3.fromDegrees(t.lon, t.lat, ringHeight),
          properties: { threatId: id },
          ellipse: {
            semiMajorAxis: ringR,
            semiMinorAxis: ringR,
            material: color.withAlpha(0.0),
            outline: true,
            outlineColor: color.withAlpha(0.9 - i * 0.1),
            outlineWidth: 4,
            height: ringHeight,
            extrudedHeight: ringHeight + 1_200,
          },
        });
        shapes.push(ringEntity);
      }
      // Esfera oscura en el centro del vórtice (la "puerta")
      const orb = viewer.entities.add({
        id: `threat_shape_${id}_orb`,
        position: Cesium.Cartesian3.fromDegrees(t.lon, t.lat, baseAlt + 8_000),
        properties: { threatId: id },
        ellipsoid: {
          radii: new Cesium.Cartesian3(5_000, 5_000, 5_000),
          material: Cesium.Color.fromCssColorString("#220033").withAlpha(0.85),
          outline: true,
          outlineColor: color.withAlpha(0.9),
        },
      });
      shapes.push(orb);
      break;
    }

    case "creature": {
      // Garra/colmillo: cono apuntando al cielo (cilindro con topRadius=0)
      const baseRadius = 8_000 + power * 1_500;
      const length = 35_000 + power * 8_000;
      const claw = viewer.entities.add({
        id: `threat_shape_${id}_claw`,
        position: Cesium.Cartesian3.fromDegrees(
          t.lon,
          t.lat,
          baseAlt + length / 2,
        ),
        properties: { threatId: id },
        cylinder: {
          length,
          topRadius: 0,
          bottomRadius: baseRadius,
          material: color.withAlpha(0.7),
          outline: true,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
        },
      });
      // Base bajita y ancha (como una almohada de la garra)
      const base = viewer.entities.add({
        id: `threat_shape_${id}_base`,
        position: Cesium.Cartesian3.fromDegrees(
          t.lon,
          t.lat,
          baseAlt + 2_000,
        ),
        properties: { threatId: id },
        cylinder: {
          length: 4_000,
          topRadius: baseRadius,
          bottomRadius: baseRadius * 1.4,
          material: color.withAlpha(0.55),
          outline: true,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.8),
        },
      });
      shapes.push(claw, base);
      break;
    }
  }

  return shapes;
}

export class ThreatRenderer {
  constructor(viewer) {
    this.viewer = viewer;
    this.entitiesById = new Map(); // threatId -> [Entity]
  }

  showThreat(id) {
    if (this.entitiesById.has(id)) return;
    const t = THREATS[id];
    if (!t) return;

    const color = Cesium.Color.fromCssColorString(t.color);

    // Beam: columna vertical de luz proporcional al power, MUY alta para que
    // sea visible desde altitudes orbitales. Power 1 = 60km, power 5 = 220km.
    const beamHeight = 60000 + t.power * 40000;
    const radiusM = t.radius_km * 1000;

    // Halo de área de efecto: círculo en la superficie con un realce extruido
    const halo = this.viewer.entities.add({
      id: `threat_halo_${id}`,
      position: Cesium.Cartesian3.fromDegrees(t.lon, t.lat, 0),
      properties: { threatId: id },
      ellipse: {
        semiMajorAxis: radiusM,
        semiMinorAxis: radiusM,
        material: color.withAlpha(0.2),
        outline: true,
        outlineColor: color.withAlpha(0.85),
        outlineWidth: 3,
        height: 0,
        extrudedHeight: 5000,
      },
    });

    // Anillo extra ancho a nivel del suelo para que el área se vea desde espacio
    const ring = this.viewer.entities.add({
      id: `threat_ring_${id}`,
      position: Cesium.Cartesian3.fromDegrees(t.lon, t.lat, 0),
      properties: { threatId: id },
      ellipse: {
        semiMajorAxis: radiusM * 1.4,
        semiMinorAxis: radiusM * 1.4,
        material: color.withAlpha(0.08),
        outline: true,
        outlineColor: color.withAlpha(0.5),
      },
    });

    // Beam: forma 3D específica por categoría (la parte que conecta
    // el suelo con la geometría del cielo).
    const beamEntities = createBeam(this.viewer, t, color, beamHeight, id);

    // Geometría 3D característica de cada categoría, en lo alto del beam.
    const skyShapes = createSkyShape(this.viewer, t, color, beamHeight, id);

    // Marker: forma específica de la categoría + emoji, generado vía canvas.
    const iconImage = makeIconImage(t.icon, t.color, t.category);
    const icon = this.viewer.entities.add({
      id: `threat_icon_${id}`,
      position: Cesium.Cartesian3.fromDegrees(
        t.lon,
        t.lat,
        beamHeight + 5000,
      ),
      properties: { threatId: id },
      billboard: {
        image: iconImage,
        scale: 0.55,
        scaleByDistance: new Cesium.NearFarScalar(1.0e5, 1.0, 2.0e7, 1.6),
        disableDepthTestDistance: 3_000_000,
      },
    });

    // Nombre en label separado, una sola línea, con fondo limpio.
    const nameLabel = this.viewer.entities.add({
      id: `threat_name_${id}`,
      position: Cesium.Cartesian3.fromDegrees(
        t.lon,
        t.lat,
        beamHeight + 5000,
      ),
      properties: { threatId: id },
      label: {
        text: ` ${t.name} `, // espacios laterales evitan cualquier clip
        font: "bold 16px 'Inter', system-ui, sans-serif",
        fillColor: color,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(0, 30),
        showBackground: true,
        backgroundColor: new Cesium.Color(0, 0, 0, 0.7),
        backgroundPadding: new Cesium.Cartesian2(12, 6),
        scaleByDistance: new Cesium.NearFarScalar(1.0e5, 1.0, 2.0e7, 1.5),
        disableDepthTestDistance: 3_000_000,
      },
    });

    this.entitiesById.set(id, [
      halo,
      ring,
      ...beamEntities,
      ...skyShapes,
      icon,
      nameLabel,
    ]);
  }

  hideThreat(id) {
    const entities = this.entitiesById.get(id);
    if (!entities) return;
    for (const e of entities) this.viewer.entities.remove(e);
    this.entitiesById.delete(id);
  }

  syncWithActive(activeIds) {
    const set = new Set(activeIds);
    for (const id of [...this.entitiesById.keys()]) {
      if (!set.has(id)) this.hideThreat(id);
    }
    for (const id of set) {
      if (!this.entitiesById.has(id)) this.showThreat(id);
    }
  }
}
