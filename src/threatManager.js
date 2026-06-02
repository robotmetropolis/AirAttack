// Manager del juego: amenazas activas, aviones bajo ataque, rescates.
//
// Arquitectura:
// - threatsActive: Map<id, { threat, activatedAt }>
// - airbornesUnderAttack: Map<icao, { acid, threatId, startedAt, deadline, rescued }>
// - score, lives, rescuedCount, lostCount

import { THREATS } from "./threats.js";

// Tiempo (segundos) que tiene el player para rescatar antes de "perder" el avión
const RESCUE_TIMEOUT_S = 90;
// Distancia (m) máxima desde la cámara al avión para considerar rescate exitoso
const RESCUE_RANGE_M = 12_000;
// Cooldown entre rescates manuales (s)
const RESCUE_COOLDOWN_S = 2;
// Inmunidad post-rescate: cuando rescatás un avión, queda blindado contra
// la MISMA amenaza por este tiempo. Así evitás que si el avión sigue dentro
// del radio de la amenaza después del rescate, vuelva a caer atrapado al instante.
const POST_RESCUE_IMMUNITY_S = 60;

function distanceKm(lat1, lon1, lat2, lon2) {
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

function clampLat(lat) {
  return Math.max(-85, Math.min(85, lat));
}

function wrapLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Coordenadas de evasión: alejando el avión de la amenaza (~120 km). */
export function computeEvasionCoords(ac, threat) {
  let dLat = ac.lat - threat.lat;
  let dLon = ac.lon - threat.lon;
  const len = Math.hypot(dLat, dLon);
  if (len < 0.02) {
    dLat = 1;
    dLon = 0;
  } else {
    dLat /= len;
    dLon /= len;
  }
  const km = 120;
  const latDeg = km / 111;
  const lonDeg = km / (111 * Math.cos((ac.lat * Math.PI) / 180) || 0.2);
  return {
    lat: clampLat(ac.lat + dLat * latDeg),
    lon: wrapLon(ac.lon + dLon * lonDeg),
  };
}

export class ThreatManager {
  constructor(viewer) {
    this.viewer = viewer;
    this.activeThreats = new Map(); // threatId -> {threat, activatedAt}
    this.attacked = new Map(); // icao -> {ac, threatId, startedAt, deadlineMs}
    // Mapa de inmunidades post-rescate: clave "icao|threatId" -> expireAtMs.
    // Mientras el timestamp actual sea menor a expireAtMs, ignoramos esa
    // combinación de avión+amenaza al detectar nuevos ataques.
    this.rescueImmunity = new Map();
    this.score = 0;
    this.lives = 3;
    this.rescuedCount = 0;
    this.lostCount = 0;
    this._lastRescueAt = 0;
    // Cuando el modo chase/cinema está activo, deshabilitamos el rescate
    // automático por proximidad para que el jugador pueda observar el ataque
    // sin rescatar al avión accidentalmente al estar cerca de la cámara.
    this.proximityRescueEnabled = true;
    this.callbacks = {
      onState: null, // ({score, lives, rescued, lost, attackedCount, threatsCount}) => void
      onEvent: null, // ({type, msg}) => void  (RESCUE_OK, LOST, ATTACK, ALL_DEAD…)
    };
  }

  setProximityRescueEnabled(enabled) {
    this.proximityRescueEnabled = enabled;
  }

  // ─── Threats ────────────────────────────────────────────────────────────
  // `silent=true` evita disparar el toast/comm para activaciones masivas
  // (ej. al iniciar el juego con todas las amenazas prendidas por default).
  toggleThreat(id, { silent = false } = {}) {
    if (this.activeThreats.has(id)) {
      this.activeThreats.delete(id);
      for (const [icao, info] of this.attacked.entries()) {
        if (info.threatId === id) this.attacked.delete(icao);
      }
    } else {
      const t = THREATS[id];
      if (!t) return;
      this.activeThreats.set(id, { threat: t, id, activatedAt: Date.now() });
      if (!silent) {
        this._emitEvent("ATTACK", `${t.icon} ${t.name.toUpperCase()} ACTIVADO`);
      }
    }
    this._notifyState();
  }

  isActive(id) {
    return this.activeThreats.has(id);
  }

  // ─── Aircraft tracking ──────────────────────────────────────────────────
  /**
   * Llamar después de cada poll de OpenSky con la lista de aviones.
   * Detecta cuáles entran/salen de zona de amenaza y mantiene los timers.
   */
  updateAttacks(aircraft) {
    const now = Date.now();

    // Limpieza de inmunidades vencidas (evita que el Map crezca indefinidamente).
    for (const [key, expireAt] of this.rescueImmunity.entries()) {
      if (now > expireAt) this.rescueImmunity.delete(key);
    }

    // 1) Para cada avión, verificar si está dentro del radio de alguna amenaza activa.
    //    Excluimos las amenazas para las cuales este avión tiene inmunidad reciente.
    for (const ac of aircraft) {
      if (ac.on_ground) continue;
      let closestThreat = null;
      let closestDist = Infinity;
      for (const { threat, id } of this.activeThreats.values()) {
        const immKey = `${ac.icao}|${id}`;
        if (this.rescueImmunity.has(immKey)) continue;
        const d = distanceKm(ac.lat, ac.lon, threat.lat, threat.lon);
        if (d <= threat.radius_km && d < closestDist) {
          closestDist = d;
          closestThreat = { threat, id };
        }
      }

      if (closestThreat) {
        const existing = this.attacked.get(ac.icao);
        if (!existing || existing.threatId !== closestThreat.id) {
          // Iniciar nuevo ataque + evento (toast + sonido)
          this.attacked.set(ac.icao, {
            ac,
            threatId: closestThreat.id,
            startedAt: now,
            deadlineMs: now + RESCUE_TIMEOUT_S * 1000,
            pullT: 0,
            transmitting: false,
            evasion: null,
          });
          const t = closestThreat.threat;
          this._emitEvent(
            "AIRCRAFT_ATTACK",
            `${t.icon} ${ac.callsign} BAJO ATAQUE — ${t.name}`,
          );
        } else {
          existing.ac = ac; // refrescar estado del avión
        }
      }
    }

    // 2) Aviones que ya no están en la lista poll → quedan en attacked (no las quitamos
    //    para mantener el timer, asumimos que siguen volando)

    this._updateTractorPull();

    // 3) Procesar timeouts (perdidos) y rescates manuales
    this._tickRescues();

    this._notifyState();
  }

  /**
   * Llamar cada tick (1 Hz por ej) para procesar timeouts y proximidad
   * de la cámara para rescates pasivos.
   */
  tick() {
    this._updateTractorPull();
    this._tickRescues();
    this._notifyState();
  }

  /** A2: el avión bajo ataque se arrastra lentamente hacia la amenaza. */
  _updateTractorPull() {
    const now = Date.now();
    for (const info of this.attacked.values()) {
      if (info.rescued) continue;
      const elapsed = now - info.startedAt;
      const total = Math.max(1, info.deadlineMs - info.startedAt);
      const progress = Math.min(1, elapsed / total);
      info.pullT = Math.min(0.38, progress * 0.45);
    }
  }

  /**
   * Posición visual en el globo (tractor beam). Si está transmitiendo evasión,
   * mezcla hacia las coordenadas de escape.
   */
  getDisplayPosition(icao) {
    const info = this.attacked.get(icao);
    if (!info || info.rescued) return null;
    const ac = info.ac;
    if (ac.lat == null || ac.lon == null) return null;

    if (info.transmitting && info.evasion) {
      const t = Math.min(1, info.evasionBlend ?? 0);
      const threat = THREATS[info.threatId];
      const pulled = threat
        ? {
            lat: ac.lat + (threat.lat - ac.lat) * (info.pullT || 0),
            lon: ac.lon + (threat.lon - ac.lon) * (info.pullT || 0),
          }
        : { lat: ac.lat, lon: ac.lon };
      return {
        lat: pulled.lat + (info.evasion.lat - pulled.lat) * t,
        lon: pulled.lon + (info.evasion.lon - pulled.lon) * t,
      };
    }

    const threat = THREATS[info.threatId];
    if (!threat) return { lat: ac.lat, lon: ac.lon };
    const t = info.pullT || 0;
    return {
      lat: ac.lat + (threat.lat - ac.lat) * t,
      lon: ac.lon + (threat.lon - ac.lon) * t,
    };
  }

  _tickRescues() {
    const now = Date.now();

    for (const [icao, info] of [...this.attacked.entries()]) {
      if (info.rescued) {
        // Limpieza después de un breve tiempo
        if (now - info.rescuedAt > 3000) this.attacked.delete(icao);
        continue;
      }

      // Timeout: perdido
      if (now > info.deadlineMs) {
        this.attacked.delete(icao);
        this.lives = Math.max(0, this.lives - 1);
        this.lostCount++;
        this._emitEvent(
          "LOST",
          `❌ ${info.ac.callsign} perdido (${this._threatName(info.threatId)})`,
        );
        if (this.lives <= 0) {
          this._emitEvent("GAME_OVER", "💀 GAME OVER. Sin vidas.");
        }
        continue;
      }

      // El rescate por proximidad de cámara estaba pensado para Cesium con
      // chase camera. Globe-edition es siempre vista global, sólo rescate
      // manual (botón). El flag queda para tests/legacy pero no se usa.
    }
  }

  /**
   * Paso 1 del rescate: enviar coordenadas de evasión al piloto.
   * Devuelve { lat, lon } o null si no aplica.
   */
  startRescueTransmit(icao) {
    const now = Date.now();
    if (now - this._lastRescueAt < RESCUE_COOLDOWN_S * 1000) return null;
    const info = this.attacked.get(icao);
    if (!info || info.rescued || info.transmitting) return null;
    const threat = THREATS[info.threatId];
    if (!threat) return null;
    info.transmitting = true;
    info.evasion = computeEvasionCoords(info.ac, threat);
    info.evasionBlend = 0;
    info.transmitStartedAt = now;
    return { ...info.evasion, callsign: info.ac.callsign || icao };
  }

  /** Avanza la mezcla visual hacia la ruta de evasión mientras transmite. */
  tickRescueTransmit(icao) {
    const info = this.attacked.get(icao);
    if (!info?.transmitting) return 1;
    const elapsed = Date.now() - (info.transmitStartedAt || Date.now());
    info.evasionBlend = Math.min(1, elapsed / 2800);
    return info.evasionBlend;
  }

  /** Paso 2: el piloto acepta y se completa el rescate. */
  finishRescueTransmit(icao) {
    const info = this.attacked.get(icao);
    if (!info || info.rescued || !info.transmitting) return false;
    info.transmitting = false;
    this._lastRescueAt = Date.now();
    this._completeRescue(icao, "MANUAL");
    return true;
  }

  /** @deprecated usar startRescueTransmit + finishRescueTransmit */
  manualRescue(icao) {
    const ev = this.startRescueTransmit(icao);
    if (!ev) return false;
    this.finishRescueTransmit(icao);
    return true;
  }

  _completeRescue(icao, mode) {
    const info = this.attacked.get(icao);
    if (!info || info.rescued) return;
    info.rescued = true;
    info.rescuedAt = Date.now();
    const points = mode === "MANUAL" ? 75 : 50;
    this.score += points;
    this.rescuedCount++;
    // Inmunidad temporal: el avión queda blindado contra esta MISMA amenaza
    // durante POST_RESCUE_IMMUNITY_S segundos para que pueda alejarse del radio.
    const immKey = `${icao}|${info.threatId}`;
    this.rescueImmunity.set(immKey, info.rescuedAt + POST_RESCUE_IMMUNITY_S * 1000);
    this._emitEvent(
      "RESCUE_OK",
      `✅ ${info.ac.callsign} RESCATADO (+${points})`,
      { ac: info.ac },
    );
  }

  isUnderAttack(icao) {
    const i = this.attacked.get(icao);
    return i && !i.rescued;
  }

  getAttackInfo(icao) {
    return this.attacked.get(icao) || null;
  }

  attackedList() {
    return [...this.attacked.values()].filter((i) => !i.rescued);
  }

  /** Amenazas con al menos un avión capturado ahora (threatId → cantidad). */
  getCaptureCountsByThreat() {
    const counts = new Map();
    for (const info of this.attackedList()) {
      counts.set(info.threatId, (counts.get(info.threatId) || 0) + 1);
    }
    return counts;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────
  _threatName(id) {
    return THREATS[id]?.name || id;
  }

  _emitEvent(type, msg, extra = {}) {
    this.callbacks.onEvent?.({ type, msg, t: new Date(), ...extra });
  }

  _notifyState() {
    this.callbacks.onState?.({
      score: this.score,
      lives: this.lives,
      rescued: this.rescuedCount,
      lost: this.lostCount,
      attackedCount: this.attackedList().length,
      threatsCount: this.activeThreats.size,
    });
  }
}
