// Presets de zonas geográficas con bbox para OpenSky.
// Cada preset tiene lat/lon central + bbox + zoom recomendado de cámara.

export const PRESETS = {
  // ─── Argentina ────────────────────────────────────────────────────────────
  AEP: {
    label: "Aeroparque (SABE)",
    region: "Argentina",
    icao: "SABE",
    lat: -34.5592,
    lon: -58.4156,
    bbox: { lamin: -35.4, lamax: -33.7, lomin: -59.4, lomax: -57.4 },
    height: 60_000,
  },
  EZE: {
    label: "Ezeiza (SAEZ)",
    region: "Argentina",
    icao: "SAEZ",
    lat: -34.8222,
    lon: -58.5358,
    bbox: { lamin: -35.6, lamax: -34.0, lomin: -59.6, lomax: -57.4 },
    height: 60_000,
  },
  COR: {
    label: "Córdoba (SACO)",
    region: "Argentina",
    icao: "SACO",
    lat: -31.3236,
    lon: -64.2080,
    bbox: { lamin: -32.2, lamax: -30.5, lomin: -65.2, lomax: -63.2 },
    height: 60_000,
  },

  // ─── Sudamérica ───────────────────────────────────────────────────────────
  GRU: {
    label: "São Paulo (SBGR)",
    region: "Brasil",
    icao: "SBGR",
    lat: -23.4356,
    lon: -46.4731,
    bbox: { lamin: -24.3, lamax: -22.6, lomin: -47.4, lomax: -45.5 },
    height: 80_000,
  },
  SCL: {
    label: "Santiago (SCEL)",
    region: "Chile",
    icao: "SCEL",
    lat: -33.3930,
    lon: -70.7858,
    bbox: { lamin: -34.2, lamax: -32.5, lomin: -71.7, lomax: -69.8 },
    height: 80_000,
  },

  // ─── EE.UU. ──────────────────────────────────────────────────────────────
  JFK: {
    label: "New York JFK (KJFK)",
    region: "USA",
    icao: "KJFK",
    lat: 40.6413,
    lon: -73.7781,
    bbox: { lamin: 40.0, lamax: 41.3, lomin: -74.5, lomax: -73.0 },
    height: 50_000,
  },
  LAX: {
    label: "Los Angeles (KLAX)",
    region: "USA",
    icao: "KLAX",
    lat: 33.9416,
    lon: -118.4085,
    bbox: { lamin: 33.4, lamax: 34.6, lomin: -119.2, lomax: -117.5 },
    height: 50_000,
  },
  ORD: {
    label: "Chicago O'Hare (KORD)",
    region: "USA",
    icao: "KORD",
    lat: 41.9742,
    lon: -87.9073,
    bbox: { lamin: 41.4, lamax: 42.6, lomin: -88.6, lomax: -87.2 },
    height: 50_000,
  },
  MIA: {
    label: "Miami (KMIA)",
    region: "USA",
    icao: "KMIA",
    lat: 25.7959,
    lon: -80.2870,
    bbox: { lamin: 25.2, lamax: 26.4, lomin: -80.9, lomax: -79.8 },
    height: 50_000,
  },

  // ─── Europa ──────────────────────────────────────────────────────────────
  LHR: {
    label: "London Heathrow (EGLL)",
    region: "UK",
    icao: "EGLL",
    lat: 51.4700,
    lon: -0.4543,
    bbox: { lamin: 51.0, lamax: 51.9, lomin: -1.2, lomax: 0.3 },
    height: 50_000,
  },
  CDG: {
    label: "Paris CDG (LFPG)",
    region: "Francia",
    icao: "LFPG",
    lat: 49.0097,
    lon: 2.5479,
    bbox: { lamin: 48.5, lamax: 49.5, lomin: 1.8, lomax: 3.2 },
    height: 50_000,
  },
  FRA: {
    label: "Frankfurt (EDDF)",
    region: "Alemania",
    icao: "EDDF",
    lat: 50.0379,
    lon: 8.5622,
    bbox: { lamin: 49.5, lamax: 50.5, lomin: 7.8, lomax: 9.3 },
    height: 50_000,
  },
  MAD: {
    label: "Madrid Barajas (LEMD)",
    region: "España",
    icao: "LEMD",
    lat: 40.4936,
    lon: -3.5668,
    bbox: { lamin: 40.0, lamax: 41.0, lomin: -4.3, lomax: -2.8 },
    height: 50_000,
  },

  // ─── Asia ────────────────────────────────────────────────────────────────
  HND: {
    label: "Tokyo Haneda (RJTT)",
    region: "Japón",
    icao: "RJTT",
    lat: 35.5494,
    lon: 139.7798,
    bbox: { lamin: 35.0, lamax: 36.1, lomin: 139.0, lomax: 140.5 },
    height: 50_000,
  },
  DXB: {
    label: "Dubai (OMDB)",
    region: "UAE",
    icao: "OMDB",
    lat: 25.2532,
    lon: 55.3657,
    bbox: { lamin: 24.7, lamax: 25.8, lomin: 54.7, lomax: 56.0 },
    height: 50_000,
  },

  // ─── Vista panorámica ─────────────────────────────────────────────────────
  ARG: {
    label: "Argentina (toda)",
    region: "Argentina",
    icao: "AR",
    lat: -38.4,
    lon: -63.6,
    bbox: { lamin: -55.0, lamax: -22.0, lomin: -73.5, lomax: -53.0 },
    height: 2_500_000,
  },
  USA: {
    label: "EE.UU. (todo)",
    region: "USA",
    icao: "US",
    lat: 39.5,
    lon: -98.5,
    bbox: { lamin: 24.5, lamax: 49.5, lomin: -125.0, lomax: -66.0 },
    height: 6_000_000,
  },
  EUR: {
    label: "Europa (toda)",
    region: "Europa",
    icao: "EU",
    lat: 50.0,
    lon: 10.0,
    bbox: { lamin: 35.0, lamax: 60.0, lomin: -10.0, lomax: 30.0 },
    height: 4_500_000,
  },
};

// Agrupados por región para mostrar en la UI
export const REGIONES = {
  Argentina: ["AEP", "EZE", "COR", "ARG"],
  Sudamérica: ["GRU", "SCL"],
  Norteamérica: ["JFK", "LAX", "ORD", "MIA", "USA"],
  Europa: ["LHR", "CDG", "FRA", "MAD", "EUR"],
  Asia: ["HND", "DXB"],
};
