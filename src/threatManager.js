// Manager del juego: amenazas activas, aviones bajo ataque, rescates.
//
// Arquitectura:
// - threatsActive: Map<id, { threat, activatedAt }>
// - airbornesUnderAttack: Map<icao, { acid, threatId, startedAt, deadline, rescued }>
// - score, lives, rescuedCount, lostCount

import * as Cesium from "cesium";
import { THREATS } from "./threats.js";

// Tiempo (segundos) que tiene el player para rescatar antes de "perder" el avión
const RESCUE_TIMEOUT_S = 90;
// Distancia (m) máxima desde la cámara al avión para considerar rescate exitoso
const RESCUE_RANGE_M = 12_000;
// Cooldown entre rescates manuales (s)
const RESCUE_COOLDOWN_S = 2;

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

    // 1) Para cada avión, verificar si está dentro del radio de alguna amenaza activa
    for (const ac of aircraft) {
      if (ac.on_ground) continue;
      let closestThreat = null;
      let closestDist = Infinity;
      for (const { threat, id } of this.activeThreats.values()) {
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
    const cameraPos = this._cameraGeodetic();

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

      // Rescate pasivo: la cámara está cerca del avión durante el ataque.
      // Se desactiva cuando hay un chase activo para no rescatar de forma
      // accidental al observar al avión bajo ataque.
      if (this.proximityRescueEnabled && cameraPos) {
        const d = distanceKm(
          cameraPos.lat,
          cameraPos.lon,
          info.ac.lat,
          info.ac.lon,
        );
        if (d * 1000 <= RESCUE_RANGE_M) {
          this._completeRescue(icao, "PROXIMITY");
        }
      }
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
    const cameraPos = this._cameraGeodetic();
    if (cameraPos) {
      const d = distanceKm(
        cameraPos.lat,
        cameraPos.lon,
        info.ac.lat,
        info.ac.lon,
      );
      if (d > 100) {
        this._emitEvent(
          "RESCUE_FAR",
          `Acercate a ${info.ac.callsign} (${d.toFixed(0)} km)`,
        );
        return false;
      }
    }
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
    this._emitEvent(
      "RESCUE_OK",
      `✅ ${info.ac.callsign} RESCATADO (+${points})`,
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
  _cameraGeodetic() {
    const cart = this.viewer.camera.positionCartographic;
    if (!cart) return null;
    return {
      lat: Cesium.Math.toDegrees(cart.latitude),
      lon: Cesium.Math.toDegrees(cart.longitude),
    };
  }

  _threatName(id) {
    return THREATS[id]?.name || id;
  }

  _emitEvent(type, msg) {
    this.callbacks.onEvent?.({ type, msg, t: new Date() });
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
