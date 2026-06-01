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

    // 3) Procesar timeouts (perdidos) y rescates manuales
    this._tickRescues();

    this._notifyState();
  }

  /**
   * Llamar cada tick (1 Hz por ej) para procesar timeouts y proximidad
   * de la cámara para rescates pasivos.
   */
  tick() {
    this._tickRescues();
    this._notifyState();
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
   * Rescate manual (botón en HUD). Sólo funciona si el avión está bajo
   * ataque y no hay cooldown. La cámara debe estar a < 100 km (no tan
   * estricto como rescate pasivo).
   */
  manualRescue(icao) {
    const now = Date.now();
    if (now - this._lastRescueAt < RESCUE_COOLDOWN_S * 1000) return false;
    const info = this.attacked.get(icao);
    if (!info || info.rescued) return false;
    // Globe-edition: rescate sin condición de distancia (todo es vista global).
    // El cooldown corto (2 s) evita spam de clicks.
    this._lastRescueAt = now;
    this._completeRescue(icao, "MANUAL");
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
