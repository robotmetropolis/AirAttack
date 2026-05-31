// OpenSky Network: capa de fetch + parseo.
//
// Por default va contra /api/opensky/* que el dev server de Vite proxiea
// hacia http://localhost:8787 (proxy Node con OAuth2 + 4000 créditos/día).
// Si el proxy no está corriendo, podés cambiar VITE_OPENSKY_USE_PROXY=false
// y el frontend caerá a llamadas directas a opensky-network.org (limitadas
// a 400 créditos/día y con problemas de CORS en producción).

const URL_BASE = "/api/opensky/states/all";

// Estructura del estado en la respuesta de OpenSky:
//   [icao24, callsign, origin_country, time_position, last_contact, lon, lat,
//    baro_alt, on_ground, velocity, true_track, vertical_rate, sensors,
//    geo_alt, squawk, spi, position_source, category]
function parseStates(states) {
  if (!Array.isArray(states)) return [];
  return states
    .map((s) => ({
      icao: s[0],
      callsign: (s[1] || "").trim() || s[0]?.toUpperCase() || "----",
      country: s[2],
      lon: s[5],
      lat: s[6],
      baro_alt: s[7],
      on_ground: s[8],
      velocity: s[9],
      heading: s[10],
      vertical_rate: s[11],
      geo_alt: s[13],
      squawk: s[14],
      category: s[17] ?? 0,
    }))
    .filter((p) => p.lon != null && p.lat != null);
}

/**
 * Pide los aviones dentro de una bbox.
 * Devuelve { aircraft: [...], creditsRemaining: number|null, ok: boolean }
 */
export async function fetchAircraft(bbox) {
  const url =
    `${URL_BASE}?extended=1` +
    `&lamin=${bbox.lamin}&lamax=${bbox.lamax}` +
    `&lomin=${bbox.lomin}&lomax=${bbox.lomax}`;

  try {
    const r = await fetch(url, { method: "GET" });
    const credits = r.headers.get("X-Rate-Limit-Remaining");
    if (!r.ok) {
      return {
        aircraft: [],
        creditsRemaining: credits ? Number(credits) : null,
        ok: false,
        status: r.status,
      };
    }
    const json = await r.json();
    return {
      aircraft: parseStates(json.states),
      creditsRemaining: credits ? Number(credits) : null,
      ok: true,
      time: json.time,
    };
  } catch (err) {
    console.error("[opensky] fetch error", err);
    return {
      aircraft: [],
      creditsRemaining: null,
      ok: false,
      error: err.message,
    };
  }
}
