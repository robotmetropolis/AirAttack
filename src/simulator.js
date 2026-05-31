// Simulador de tráfico aéreo mundial.
// Genera N vuelos entre aeropuertos reales, calcula posición interpolada
// (great circle), heading, altitud y vertical_rate.
//
// Output compatible con el shape de OpenSky parseado en opensky.js:
//   { icao, callsign, country, lat, lon, baro_alt, on_ground,
//     velocity, heading, vertical_rate, geo_alt, category }

// ── Aeropuertos hub mundiales ────────────────────────────────────────────
const HUBS = [
  // ─ South America
  { icao: "SABE", lat: -34.5594, lon: -58.4153, name: "Aeroparque" },
  { icao: "SAEZ", lat: -34.8222, lon: -58.5358, name: "Ezeiza" },
  { icao: "SACO", lat: -31.3236, lon: -64.2080, name: "Córdoba" },
  { icao: "SBGR", lat: -23.4356, lon: -46.4731, name: "São Paulo" },
  { icao: "SBGL", lat: -22.8089, lon: -43.2436, name: "Galeão" },
  { icao: "SCEL", lat: -33.3930, lon: -70.7858, name: "Santiago" },
  { icao: "SPIM", lat: -12.0219, lon: -77.1143, name: "Lima" },
  { icao: "SKBO", lat: 4.7016, lon: -74.1469, name: "Bogotá" },
  // ─ North America
  { icao: "KJFK", lat: 40.6413, lon: -73.7781, name: "JFK" },
  { icao: "KLAX", lat: 33.9416, lon: -118.4085, name: "LAX" },
  { icao: "KORD", lat: 41.9742, lon: -87.9073, name: "O'Hare" },
  { icao: "KATL", lat: 33.6407, lon: -84.4277, name: "Atlanta" },
  { icao: "KMIA", lat: 25.7959, lon: -80.2870, name: "Miami" },
  { icao: "KDFW", lat: 32.8998, lon: -97.0403, name: "Dallas" },
  { icao: "KSEA", lat: 47.4502, lon: -122.3088, name: "Seattle" },
  { icao: "KSFO", lat: 37.6188, lon: -122.3754, name: "San Francisco" },
  { icao: "KBOS", lat: 42.3656, lon: -71.0096, name: "Boston" },
  { icao: "CYYZ", lat: 43.6772, lon: -79.6306, name: "Toronto" },
  { icao: "CYVR", lat: 49.1967, lon: -123.1815, name: "Vancouver" },
  { icao: "MMMX", lat: 19.4361, lon: -99.0719, name: "México City" },
  { icao: "MPTO", lat: 9.0714, lon: -79.3835, name: "Panamá" },
  // ─ Europe
  { icao: "EGLL", lat: 51.4700, lon: -0.4543, name: "Heathrow" },
  { icao: "EGKK", lat: 51.1481, lon: -0.1903, name: "Gatwick" },
  { icao: "LFPG", lat: 49.0097, lon: 2.5479, name: "CDG" },
  { icao: "EDDF", lat: 50.0379, lon: 8.5622, name: "Frankfurt" },
  { icao: "EDDM", lat: 48.3538, lon: 11.7861, name: "Munich" },
  { icao: "EHAM", lat: 52.3086, lon: 4.7639, name: "Amsterdam" },
  { icao: "LEMD", lat: 40.4936, lon: -3.5668, name: "Madrid" },
  { icao: "LEBL", lat: 41.2974, lon: 2.0833, name: "Barcelona" },
  { icao: "LIRF", lat: 41.8003, lon: 12.2389, name: "Roma FCO" },
  { icao: "LIMC", lat: 45.6306, lon: 8.7281, name: "Milán MXP" },
  { icao: "LSZH", lat: 47.4647, lon: 8.5492, name: "Zurich" },
  { icao: "LOWW", lat: 48.1102, lon: 16.5697, name: "Viena" },
  { icao: "LPPT", lat: 38.7813, lon: -9.1359, name: "Lisboa" },
  { icao: "ESSA", lat: 59.6519, lon: 17.9186, name: "Estocolmo" },
  { icao: "EKCH", lat: 55.6181, lon: 12.6561, name: "Copenhague" },
  { icao: "EIDW", lat: 53.4214, lon: -6.2701, name: "Dublín" },
  { icao: "BIKF", lat: 63.985, lon: -22.6056, name: "Reykjavik" },
  { icao: "UUEE", lat: 55.9728, lon: 37.4147, name: "Moscú SVO" },
  { icao: "LTBA", lat: 40.9764, lon: 28.8147, name: "Estambul" },
  // ─ Middle East
  { icao: "OMDB", lat: 25.2532, lon: 55.3657, name: "Dubai" },
  { icao: "OTHH", lat: 25.2731, lon: 51.6080, name: "Doha" },
  { icao: "OEJN", lat: 21.6797, lon: 39.1564, name: "Jeddah" },
  { icao: "LLBG", lat: 32.0114, lon: 34.8867, name: "Tel Aviv" },
  { icao: "HECA", lat: 30.1219, lon: 31.4056, name: "El Cairo" },
  // ─ Asia
  { icao: "RJTT", lat: 35.5494, lon: 139.7798, name: "Haneda" },
  { icao: "RJAA", lat: 35.7647, lon: 140.3864, name: "Narita" },
  { icao: "RKSI", lat: 37.4691, lon: 126.4505, name: "Seúl Incheon" },
  { icao: "ZBAA", lat: 40.0801, lon: 116.5846, name: "Beijing" },
  { icao: "ZSPD", lat: 31.1434, lon: 121.8052, name: "Shanghai PVG" },
  { icao: "VHHH", lat: 22.3080, lon: 113.9185, name: "Hong Kong" },
  { icao: "RCTP", lat: 25.0777, lon: 121.2328, name: "Taipei" },
  { icao: "WSSS", lat: 1.3644, lon: 103.9915, name: "Singapur" },
  { icao: "VTBS", lat: 13.6900, lon: 100.7501, name: "Bangkok" },
  { icao: "WMKK", lat: 2.7456, lon: 101.7099, name: "Kuala Lumpur" },
  { icao: "WIII", lat: -6.1256, lon: 106.6558, name: "Jakarta" },
  { icao: "RPLL", lat: 14.5086, lon: 121.0194, name: "Manila" },
  { icao: "VIDP", lat: 28.5562, lon: 77.1000, name: "Delhi" },
  { icao: "VABB", lat: 19.0896, lon: 72.8656, name: "Mumbai" },
  // ─ Oceanía
  { icao: "YSSY", lat: -33.9461, lon: 151.1772, name: "Sydney" },
  { icao: "YMML", lat: -37.6690, lon: 144.8410, name: "Melbourne" },
  { icao: "NZAA", lat: -37.0082, lon: 174.7917, name: "Auckland" },
  // ─ África
  { icao: "FAOR", lat: -26.1392, lon: 28.2460, name: "Johannesburg" },
  { icao: "FACT", lat: -33.9648, lon: 18.6017, name: "Ciudad del Cabo" },
  { icao: "HKJK", lat: -1.3192, lon: 36.9278, name: "Nairobi" },
];

// ── Aerolíneas (callsign prefix → país) ──────────────────────────────────
const AIRLINES = [
  { code: "AAL", country: "United States", name: "American" },
  { code: "DAL", country: "United States", name: "Delta" },
  { code: "UAL", country: "United States", name: "United" },
  { code: "SWA", country: "United States", name: "Southwest" },
  { code: "JBU", country: "United States", name: "JetBlue" },
  { code: "ACA", country: "Canada", name: "Air Canada" },
  { code: "BAW", country: "United Kingdom", name: "Speedbird" },
  { code: "AFR", country: "France", name: "Air France" },
  { code: "DLH", country: "Germany", name: "Lufthansa" },
  { code: "KLM", country: "Netherlands", name: "KLM" },
  { code: "IBE", country: "Spain", name: "Iberia" },
  { code: "AZA", country: "Italy", name: "ITA" },
  { code: "SWR", country: "Switzerland", name: "Swiss" },
  { code: "SAS", country: "Sweden", name: "Scandinavian" },
  { code: "FIN", country: "Finland", name: "Finnair" },
  { code: "ICE", country: "Iceland", name: "Icelandair" },
  { code: "TAP", country: "Portugal", name: "TAP" },
  { code: "AUA", country: "Austria", name: "Austrian" },
  { code: "AEA", country: "Spain", name: "Air Europa" },
  { code: "RYR", country: "Ireland", name: "Ryanair" },
  { code: "EZY", country: "United Kingdom", name: "easyJet" },
  { code: "VLG", country: "Spain", name: "Vueling" },
  { code: "THY", country: "Turkey", name: "Turkish" },
  { code: "AEE", country: "Greece", name: "Aegean" },
  { code: "AFL", country: "Russia", name: "Aeroflot" },
  { code: "UAE", country: "United Arab Emirates", name: "Emirates" },
  { code: "ETD", country: "United Arab Emirates", name: "Etihad" },
  { code: "QTR", country: "Qatar", name: "Qatar" },
  { code: "SVA", country: "Saudi Arabia", name: "Saudia" },
  { code: "ELY", country: "Israel", name: "El Al" },
  { code: "ANA", country: "Japan", name: "All Nippon" },
  { code: "JAL", country: "Japan", name: "Japan Airlines" },
  { code: "KAL", country: "South Korea", name: "Korean Air" },
  { code: "AAR", country: "South Korea", name: "Asiana" },
  { code: "CCA", country: "China", name: "Air China" },
  { code: "CES", country: "China", name: "China Eastern" },
  { code: "CSN", country: "China", name: "China Southern" },
  { code: "CPA", country: "Hong Kong", name: "Cathay Pacific" },
  { code: "EVA", country: "Taiwan", name: "EVA Air" },
  { code: "SIA", country: "Singapore", name: "Singapore" },
  { code: "MAS", country: "Malaysia", name: "Malaysian" },
  { code: "THA", country: "Thailand", name: "Thai" },
  { code: "GIA", country: "Indonesia", name: "Garuda" },
  { code: "PAL", country: "Philippines", name: "Philippine" },
  { code: "AIC", country: "India", name: "Air India" },
  { code: "QFA", country: "Australia", name: "Qantas" },
  { code: "ANZ", country: "New Zealand", name: "Air New Zealand" },
  { code: "ARG", country: "Argentina", name: "Aerolíneas" },
  { code: "TAM", country: "Brazil", name: "LATAM" },
  { code: "AVA", country: "Colombia", name: "Avianca" },
  { code: "AMX", country: "Mexico", name: "Aeroméxico" },
  { code: "VIV", country: "Mexico", name: "Viva Aerobus" },
  { code: "CMP", country: "Panama", name: "Copa" },
  { code: "SAA", country: "South Africa", name: "South African" },
  { code: "MSR", country: "Egypt", name: "EgyptAir" },
  { code: "ETH", country: "Ethiopia", name: "Ethiopian" },
];

// Categorías ADS-B con peso (para sortear)
const CATEGORIES = [
  { cat: 6, weight: 25 }, // heavy (long-haul)
  { cat: 4, weight: 35 }, // large
  { cat: 3, weight: 25 }, // small
  { cat: 2, weight: 10 }, // light
  { cat: 5, weight: 5 }, // high vortex
];

// ── Helpers ──────────────────────────────────────────────────────────────
function rnd(min, max) {
  return Math.random() * (max - min) + min;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickWeighted(items) {
  const total = items.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const x of items) {
    r -= x.weight;
    if (r <= 0) return x;
  }
  return items[0];
}

function hex24() {
  let s = "";
  const hex = "0123456789abcdef";
  for (let i = 0; i < 6; i++) s += hex[Math.floor(Math.random() * 16)];
  return s;
}

// Distance in km between two lat/lon points (Haversine)
function haversineKm(lat1, lon1, lat2, lon2) {
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

// Bearing inicial (degrees, 0=N) desde (lat1,lon1) hacia (lat2,lon2)
function initialBearing(lat1, lon1, lat2, lon2) {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

// Interpolación great circle (slerp) entre dos puntos lat/lon, t en [0,1]
function gcInterp(lat1, lon1, lat2, lon2, t) {
  const φ1 = (lat1 * Math.PI) / 180;
  const λ1 = (lon1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const λ2 = (lon2 * Math.PI) / 180;
  const dist =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((φ2 - φ1) / 2) ** 2 +
          Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2,
      ),
    );
  if (dist === 0) return { lat: lat1, lon: lon1 };
  const a = Math.sin((1 - t) * dist) / Math.sin(dist);
  const b = Math.sin(t * dist) / Math.sin(dist);
  const x = a * Math.cos(φ1) * Math.cos(λ1) + b * Math.cos(φ2) * Math.cos(λ2);
  const y = a * Math.cos(φ1) * Math.sin(λ1) + b * Math.cos(φ2) * Math.sin(λ2);
  const z = a * Math.sin(φ1) + b * Math.sin(φ2);
  const lat = (Math.atan2(z, Math.sqrt(x * x + y * y)) * 180) / Math.PI;
  const lon = (Math.atan2(y, x) * 180) / Math.PI;
  return { lat, lon };
}

// Perfil simple de altitud: sube los primeros 8%, crucero, baja últimos 10%
function altProfile(t, cruiseAlt) {
  if (t < 0.08) return cruiseAlt * (t / 0.08);
  if (t > 0.9) return cruiseAlt * (1 - (t - 0.9) / 0.1);
  return cruiseAlt;
}

function vrProfile(t, cruiseAlt) {
  if (t < 0.08) return (cruiseAlt / (0.08 * 60 * 60)) * 0.4; // ~m/s
  if (t > 0.9) return -(cruiseAlt / (0.1 * 60 * 60)) * 0.5;
  return 0;
}

// ── Simulator ────────────────────────────────────────────────────────────
export class Simulator {
  constructor(numFlights = 80) {
    this.numFlights = numFlights;
    this.flights = [];
    this._regen();
  }

  _regen() {
    this.flights = [];
    for (let i = 0; i < this.numFlights; i++) {
      this.flights.push(this._createFlight(true));
    }
  }

  _createFlight(staggerStart = false) {
    const origin = pickRandom(HUBS);
    let dest;
    do {
      dest = pickRandom(HUBS);
    } while (dest.icao === origin.icao);

    const distKm = haversineKm(origin.lat, origin.lon, dest.lat, dest.lon);
    const cruiseSpeed = 220 + Math.random() * 60; // m/s
    const durationS = (distKm * 1000) / cruiseSpeed;
    // Altitud crucero según distancia: short-haul vuela más bajo
    const cruiseAlt =
      distKm < 800
        ? 7000 + Math.random() * 2000
        : 9500 + Math.random() * 3000;

    const airline = pickRandom(AIRLINES);
    const fnum = Math.floor(100 + Math.random() * 8900);
    const callsign = `${airline.code}${fnum}`;

    return {
      icao: hex24(),
      callsign,
      country: airline.country,
      airline: airline.name,
      origin,
      destination: dest,
      distance_km: distKm,
      cruiseSpeed,
      cruiseAlt,
      durationS,
      // si stagger=true, distribuir flights en distintas etapas
      startedAt: staggerStart
        ? Date.now() - Math.random() * durationS * 1000
        : Date.now(),
      category: pickWeighted(CATEGORIES).cat,
    };
  }

  /**
   * Devuelve el snapshot actual de aviones, formato compatible con OpenSky.
   * Si bbox está dado, filtra solo los que estén dentro.
   */
  getAircraft(bbox) {
    const now = Date.now();
    const result = [];
    for (let i = 0; i < this.flights.length; i++) {
      const f = this.flights[i];
      const elapsed = (now - f.startedAt) / 1000;
      let progress = elapsed / f.durationS;

      if (progress >= 1.0) {
        // Vuelo terminó, regenerar con nueva ruta
        this.flights[i] = this._createFlight(false);
        continue;
      }

      const { lat, lon } = gcInterp(
        f.origin.lat,
        f.origin.lon,
        f.destination.lat,
        f.destination.lon,
        progress,
      );

      // Si hay bbox, filtrar
      if (
        bbox &&
        (lat < bbox.lamin ||
          lat > bbox.lamax ||
          lon < bbox.lomin ||
          lon > bbox.lomax)
      ) {
        continue;
      }

      const heading = initialBearing(
        lat,
        lon,
        f.destination.lat,
        f.destination.lon,
      );
      const altitude = altProfile(progress, f.cruiseAlt);
      const vr = vrProfile(progress, f.cruiseAlt);

      result.push({
        icao: f.icao,
        callsign: f.callsign,
        country: f.country,
        lat,
        lon,
        baro_alt: altitude,
        on_ground: false,
        velocity: f.cruiseSpeed,
        heading,
        vertical_rate: vr,
        geo_alt: altitude,
        squawk: null,
        category: f.category,
        // Extra: campos sólo del simulador, útil para tooltips
        _origin: f.origin.icao,
        _destination: f.destination.icao,
        _airline: f.airline,
      });
    }
    return result;
  }

  /**
   * Cambia el número de vuelos simulados (regenera flota).
   */
  setNumFlights(n) {
    this.numFlights = Math.max(10, Math.min(500, n));
    this._regen();
  }
}
