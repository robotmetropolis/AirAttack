// Base de datos curada de aeropuertos importantes con sus runways principales.
//
// Formato de cada runway:
//   { name, center: [lat, lon], heading_deg, length_m, width_m }
//
// - heading_deg es el HEADING GEOGRÁFICO (referencia norte verdadero, no magnético).
//   Para convertir desde el nombre de la pista (que es heading magnético/10):
//     heading_geo = heading_mag + variación_magnética
//   Variación local (≈ 2026):
//     Buenos Aires: -8°, São Paulo: -23°, Santiago: +5°, NYC: -13°, LAX: +11°,
//     Chicago: -2°, Miami: -7°, London: +1°, Paris: +1°, Frankfurt: +3°,
//     Madrid: +0°, Tokyo: -7°, Dubai: +2°
//
// - center es el centro geométrico de la pista. El polígono se construye
//   extruyendo ±length/2 a lo largo del heading y ±width/2 perpendicular.

import * as Cesium from "cesium";

export const AIRPORTS = {
  SABE: {
    name: "Aeroparque Jorge Newbery",
    city: "Buenos Aires",
    country: "AR",
    elevation_m: 6,
    runways: [
      // RWY 13/31: heading mag 130 + decl -8 = 122° geo, longitud 2109 m
      { name: "13/31", center: [-34.5594, -58.4153], heading: 132, length: 2109, width: 40 },
    ],
  },

  SAEZ: {
    name: "Ezeiza Pistarini",
    city: "Buenos Aires",
    country: "AR",
    elevation_m: 20,
    runways: [
      // RWY 11/29: heading mag 110 + decl -8 = 102° geo, 3105 m
      { name: "11/29", center: [-34.8200, -58.5360], heading: 102, length: 3105, width: 60 },
      // RWY 17/35: heading mag 170 + decl -8 = 162° geo, 3300 m
      { name: "17/35", center: [-34.8235, -58.5380], heading: 162, length: 3300, width: 60 },
    ],
  },

  SACO: {
    name: "Ingeniero Taravella",
    city: "Córdoba",
    country: "AR",
    elevation_m: 495,
    runways: [
      // RWY 18/36: heading mag 180 + decl -5 = 175° geo, 3200 m
      { name: "18/36", center: [-31.3236, -64.2080], heading: 175, length: 3200, width: 45 },
    ],
  },

  SBGR: {
    name: "Guarulhos",
    city: "São Paulo",
    country: "BR",
    elevation_m: 750,
    runways: [
      // RWY 09L/27R (norte): heading mag 095 + decl -23 = 072° geo, 3000 m
      { name: "09L/27R", center: [-23.4289, -46.4733], heading: 72, length: 3000, width: 45 },
      // RWY 09R/27L (sur): 3700 m
      { name: "09R/27L", center: [-23.4356, -46.4683], heading: 72, length: 3700, width: 45 },
    ],
  },

  SCEL: {
    name: "Arturo Merino Benítez",
    city: "Santiago",
    country: "CL",
    elevation_m: 474,
    runways: [
      // RWY 17L/35R (este): heading mag 170 + decl +5 = 175° geo, 3750 m
      { name: "17L/35R", center: [-33.3930, -70.7800], heading: 175, length: 3750, width: 45 },
      // RWY 17R/35L (oeste): 3800 m
      { name: "17R/35L", center: [-33.3930, -70.7920], heading: 175, length: 3800, width: 45 },
    ],
  },

  KJFK: {
    name: "John F. Kennedy",
    city: "New York",
    country: "US",
    elevation_m: 4,
    runways: [
      // RWY 04L/22R: heading mag 040 + decl -13 = 027° geo, 3460 m
      { name: "04L/22R", center: [40.6347, -73.7806], heading: 27, length: 3460, width: 60 },
      // RWY 04R/22L: 2560 m, paralela
      { name: "04R/22L", center: [40.6347, -73.7900], heading: 27, length: 2560, width: 60 },
      // RWY 13L/31R: heading 117° geo, 3140 m
      { name: "13L/31R", center: [40.6450, -73.7900], heading: 117, length: 3140, width: 60 },
      // RWY 13R/31L: 4422 m (la "Bay Runway")
      { name: "13R/31L", center: [40.6429, -73.7920], heading: 117, length: 4422, width: 60 },
    ],
  },

  KLAX: {
    name: "Los Angeles",
    city: "Los Angeles",
    country: "US",
    elevation_m: 39,
    runways: [
      // Las 4 pistas son paralelas con heading mag ~069 + decl +11 = 080° geo
      // RWY 06L/24R (norte-norte): 3318 m
      { name: "06L/24R", center: [33.9525, -118.4170], heading: 80, length: 3318, width: 60 },
      // RWY 06R/24L (norte): 3135 m
      { name: "06R/24L", center: [33.9503, -118.4170], heading: 80, length: 3135, width: 60 },
      // RWY 07L/25R (sur): 3318 m
      { name: "07L/25R", center: [33.9404, -118.4150], heading: 80, length: 3318, width: 60 },
      // RWY 07R/25L (sur-sur): 2720 m
      { name: "07R/25L", center: [33.9361, -118.4170], heading: 80, length: 2720, width: 60 },
    ],
  },

  KORD: {
    name: "O'Hare",
    city: "Chicago",
    country: "US",
    elevation_m: 204,
    runways: [
      // Heading mag 100 + decl -2 = 098° geo
      { name: "10C/28C", center: [41.9772, -87.8890], heading: 98, length: 3290, width: 60 },
      { name: "10L/28R", center: [41.9890, -87.8950], heading: 98, length: 2286, width: 60 },
      { name: "10R/28L", center: [41.9667, -87.8950], heading: 98, length: 3047, width: 60 },
      // RWY 09L/27R y 09R/27L: heading mag 090 + decl -2 = 088° geo
      { name: "09L/27R", center: [41.9858, -87.8852], heading: 88, length: 2286, width: 60 },
      { name: "09R/27L", center: [41.9744, -87.8852], heading: 88, length: 2286, width: 60 },
      // RWY 04L/22R diagonal: heading 040 - 2 = 038° geo, 2286 m
      { name: "04L/22R", center: [41.9856, -87.9059], heading: 38, length: 2286, width: 60 },
    ],
  },

  KMIA: {
    name: "Miami International",
    city: "Miami",
    country: "US",
    elevation_m: 3,
    runways: [
      // RWY 08L/26R: heading mag 087 + decl -7 = 080° geo, 2622 m
      { name: "08L/26R", center: [25.7935, -80.2935], heading: 80, length: 2622, width: 60 },
      // RWY 08R/26L: 3230 m
      { name: "08R/26L", center: [25.7892, -80.2985], heading: 80, length: 3230, width: 60 },
      // RWY 09/27: heading mag 092 + decl -7 = 085° geo, 4000 m
      { name: "09/27", center: [25.7951, -80.3010], heading: 85, length: 4000, width: 60 },
      // RWY 12/30: heading mag 122 + decl -7 = 115° geo, 2853 m
      { name: "12/30", center: [25.7860, -80.2895], heading: 115, length: 2853, width: 60 },
    ],
  },

  EGLL: {
    name: "Heathrow",
    city: "London",
    country: "UK",
    elevation_m: 25,
    runways: [
      // RWY 09L/27R: heading mag 090 + decl +1 = 091° geo, 3902 m
      { name: "09L/27R", center: [51.4775, -0.4617], heading: 91, length: 3902, width: 50 },
      // RWY 09R/27L: 3660 m
      { name: "09R/27L", center: [51.4640, -0.4617], heading: 91, length: 3660, width: 50 },
    ],
  },

  LFPG: {
    name: "Charles de Gaulle",
    city: "Paris",
    country: "FR",
    elevation_m: 119,
    runways: [
      // RWY 08L/26R (norte): heading mag 084 + decl +1 = 085° geo, 4215 m
      { name: "08L/26R", center: [49.0192, 2.5484], heading: 85, length: 4215, width: 60 },
      // RWY 08R/26L: 4200 m
      { name: "08R/26L", center: [49.0145, 2.5484], heading: 85, length: 4200, width: 60 },
      // RWY 09L/27R: heading mag 094 + 1 = 095° geo, 2700 m
      { name: "09L/27R", center: [49.0066, 2.5484], heading: 95, length: 2700, width: 60 },
      // RWY 09R/27L (sur): 4200 m
      { name: "09R/27L", center: [49.0019, 2.5484], heading: 95, length: 4200, width: 60 },
    ],
  },

  EDDF: {
    name: "Frankfurt",
    city: "Frankfurt",
    country: "DE",
    elevation_m: 111,
    runways: [
      // RWY 07L/25R: heading mag 070 + decl +3 = 073° geo, 4000 m
      { name: "07L/25R", center: [50.0405, 8.5622], heading: 73, length: 4000, width: 60 },
      // RWY 07R/25L: 4000 m
      { name: "07R/25L", center: [50.0344, 8.5622], heading: 73, length: 4000, width: 60 },
      // RWY 07C/25C ("Nord", paralela al norte): 2800 m
      { name: "07C/25C", center: [50.0500, 8.5380], heading: 73, length: 2800, width: 60 },
      // RWY 18 (sólo aterrizajes hacia el sur): heading geo 183°
      { name: "18", center: [50.0257, 8.5320], heading: 183, length: 4000, width: 45 },
    ],
  },

  LEMD: {
    name: "Barajas",
    city: "Madrid",
    country: "ES",
    elevation_m: 609,
    runways: [
      // RWY 14L/32R: heading mag 140 + decl ~0 = 140° geo, 4350 m
      { name: "14L/32R", center: [40.4970, -3.5398], heading: 140, length: 4350, width: 60 },
      // RWY 14R/32L: 3500 m
      { name: "14R/32L", center: [40.4910, -3.5503], heading: 140, length: 3500, width: 60 },
      // RWY 18L/36R: heading mag 180 + 0 = 180° geo, 3500 m
      { name: "18L/36R", center: [40.4855, -3.5314], heading: 180, length: 3500, width: 60 },
      // RWY 18R/36L: 4100 m
      { name: "18R/36L", center: [40.4847, -3.5527], heading: 180, length: 4100, width: 60 },
    ],
  },

  RJTT: {
    name: "Haneda",
    city: "Tokyo",
    country: "JP",
    elevation_m: 6,
    runways: [
      // RWY 16L/34R (paralela este de la isla): heading mag 160 + decl -7 = 153° geo, 3000 m
      { name: "16L/34R", center: [35.5480, 139.7964], heading: 153, length: 3000, width: 60 },
      // RWY 16R/34L (paralela oeste): 3000 m
      { name: "16R/34L", center: [35.5448, 139.7828], heading: 153, length: 3000, width: 60 },
      // RWY 04/22: heading mag 040 + decl -7 = 033° geo, 2500 m
      { name: "04/22", center: [35.5481, 139.7907], heading: 33, length: 2500, width: 60 },
      // RWY 05/23: heading mag 050 + decl -7 = 043° geo, 2500 m
      { name: "05/23", center: [35.5439, 139.8015], heading: 43, length: 2500, width: 60 },
    ],
  },

  OMDB: {
    name: "Dubai International",
    city: "Dubai",
    country: "AE",
    elevation_m: 19,
    runways: [
      // RWY 12L/30R: heading mag 122 + decl +2 = 124° geo, 4000 m
      { name: "12L/30R", center: [25.2576, 55.3540], heading: 124, length: 4000, width: 60 },
      // RWY 12R/30L: 4400 m, paralela ~400m al sur
      { name: "12R/30L", center: [25.2510, 55.3540], heading: 124, length: 4400, width: 60 },
    ],
  },
};

/**
 * Calcula los dos thresholds (extremos) de una pista a partir de su centro,
 * heading geográfico (grados, 0=N, 90=E) y longitud en metros.
 *
 * Devuelve [thr1Cartesian, thr2Cartesian]. Estos dos puntos alimentan a un
 * Cesium.CorridorGraphics que dibuja el rectángulo perpendicular automático.
 */
function runwayThresholds(latCenter, lonCenter, headingDeg, lengthM, alt) {
  const cosLat = Math.cos(Cesium.Math.toRadians(latCenter));
  const headingRad = Cesium.Math.toRadians(headingDeg);
  const halfL = lengthM / 2;

  // Vector unitario "along" en (east, north)
  const eastUnit = Math.sin(headingRad);
  const northUnit = Math.cos(headingRad);

  const dLat1 = (-halfL * northUnit) / 111_320;
  const dLon1 = (-halfL * eastUnit) / (111_320 * cosLat);
  const dLat2 = (+halfL * northUnit) / 111_320;
  const dLon2 = (+halfL * eastUnit) / (111_320 * cosLat);

  return [
    Cesium.Cartesian3.fromDegrees(lonCenter + dLon1, latCenter + dLat1, alt),
    Cesium.Cartesian3.fromDegrees(lonCenter + dLon2, latCenter + dLat2, alt),
  ];
}

/**
 * AirportsManager: dibuja runways y labels de aeropuertos en el viewer.
 */
export class AirportsManager {
  constructor(viewer) {
    this.viewer = viewer;
    this.entitiesByIcao = new Map(); // icao -> [Entity, ...]
  }

  showAirport(icao) {
    const apt = AIRPORTS[icao];
    if (!apt) return;
    if (this.entitiesByIcao.has(icao)) return;

    const entities = [];

    const center = this._centroid(apt.runways);

    // Label del aeropuerto en el centro
    const labelEntity = this.viewer.entities.add({
      id: `apt_label_${icao}`,
      position: Cesium.Cartesian3.fromDegrees(
        center.lon,
        center.lat,
        apt.elevation_m + 100,
      ),
      label: {
        text: `${icao}\n${apt.name}`,
        font: "bold 13px monospace",
        fillColor: Cesium.Color.fromCssColorString("#00ff7f"),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -10),
        scaleByDistance: new Cesium.NearFarScalar(2.0e3, 1.2, 1.0e6, 0.4),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      point: {
        pixelSize: 10,
        color: Cesium.Color.fromCssColorString("#00ff7f"),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1,
        scaleByDistance: new Cesium.NearFarScalar(2.0e3, 1.4, 1.0e6, 0.5),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    entities.push(labelEntity);

    // Cada runway como corridor extruido + label
    for (const rwy of apt.runways) {
      const thresholds = runwayThresholds(
        rwy.center[0],
        rwy.center[1],
        rwy.heading,
        rwy.length,
        apt.elevation_m,
      );

      const rwyEntity = this.viewer.entities.add({
        id: `apt_rwy_${icao}_${rwy.name}`,
        corridor: {
          positions: thresholds,
          width: rwy.width,
          cornerType: Cesium.CornerType.MITERED,
          material: Cesium.Color.fromCssColorString("#1a1a1a").withAlpha(0.95),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString("#ffff00").withAlpha(
            0.7,
          ),
          height: apt.elevation_m,
          extrudedHeight: apt.elevation_m + 0.5,
        },
      });
      entities.push(rwyEntity);

      // Label de pista en el centro
      const rwyLabelEntity = this.viewer.entities.add({
        id: `apt_rwylabel_${icao}_${rwy.name}`,
        position: Cesium.Cartesian3.fromDegrees(
          rwy.center[1],
          rwy.center[0],
          apt.elevation_m + 30,
        ),
        label: {
          text: rwy.name,
          font: "bold 11px monospace",
          fillColor: Cesium.Color.YELLOW,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          scaleByDistance: new Cesium.NearFarScalar(1.0e3, 1.2, 5.0e5, 0.0),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      entities.push(rwyLabelEntity);
    }

    this.entitiesByIcao.set(icao, entities);
  }

  hideAll() {
    for (const [, entities] of this.entitiesByIcao.entries()) {
      for (const e of entities) {
        this.viewer.entities.remove(e);
      }
    }
    this.entitiesByIcao.clear();
  }

  /**
   * Muestra solo aeropuertos relevantes a una bbox dada.
   * Re-crea siempre las entities (más simple y robusto frente a cambios de código).
   */
  showInBbox(bbox) {
    this.hideAll();
    for (const icao of Object.keys(AIRPORTS)) {
      const apt = AIRPORTS[icao];
      const center = this._centroid(apt.runways);
      if (
        center.lat >= bbox.lamin - 1 &&
        center.lat <= bbox.lamax + 1 &&
        center.lon >= bbox.lomin - 1 &&
        center.lon <= bbox.lomax + 1
      ) {
        this.showAirport(icao);
      }
    }
  }

  _centroid(runways) {
    let lat = 0;
    let lon = 0;
    for (const r of runways) {
      lat += r.center[0];
      lon += r.center[1];
    }
    return { lat: lat / runways.length, lon: lon / runways.length };
  }
}
