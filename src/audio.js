// Sonidos sintetizados con Web Audio API.
// Sin archivos externos: todo se genera en runtime con osciladores.
// Diseño: sine waves limpias + filtro low-pass + envolvente exponencial
// para evitar el "chirrido" de las square/sawtooth crudas.

let audioCtx = null;
let muted = false;

function getCtx() {
  if (audioCtx) return audioCtx;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (err) {
    console.warn("[audio] Web Audio API no disponible", err);
    return null;
  }
  return audioCtx;
}

export function setMuted(value) {
  muted = !!value;
}
export function isMuted() {
  return muted;
}

function ensureRunning(ctx) {
  if (ctx.state === "suspended") ctx.resume();
}

/**
 * Toca una nota: sine wave + low-pass filter + envolvente ADSR sencilla.
 * Más cercano a sonidos de UI de videojuego que a alarma industrial.
 */
function playTone(
  ctx,
  {
    freq = 880,
    startOffset = 0,
    duration = 0.18,
    peakGain = 0.18,
    type = "sine",
    filterFreq = 3500,
    attack = 0.005,
    decay = null,
    pitchEnd = null, // si se especifica, sweep de freq → pitchEnd
  },
) {
  const now = ctx.currentTime;
  const t0 = now + startOffset;
  const tEnd = t0 + duration;
  const dec = decay ?? duration;

  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (pitchEnd != null) {
    o.frequency.exponentialRampToValueAtTime(pitchEnd, tEnd);
  }

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = filterFreq;
  filter.Q.value = 1;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peakGain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dec);

  o.connect(filter);
  filter.connect(g);
  g.connect(ctx.destination);

  o.start(t0);
  o.stop(tEnd + 0.05);
}

/**
 * Aircraft bajo ataque: doble blip estilo "radar contact" en 1100 Hz.
 * Limpio, corto, no satura.
 */
export function playAttackSound() {
  if (muted) return;
  const ctx = getCtx();
  if (!ctx) return;
  ensureRunning(ctx);

  // Dos blips rápidos
  playTone(ctx, {
    freq: 1100,
    startOffset: 0,
    duration: 0.08,
    peakGain: 0.18,
    type: "sine",
  });
  playTone(ctx, {
    freq: 1100,
    startOffset: 0.11,
    duration: 0.08,
    peakGain: 0.18,
    type: "sine",
  });
}

/**
 * Rescate exitoso: arpegio en C mayor (C5-E5-G5) tipo "level up".
 */
export function playRescueSound() {
  if (muted) return;
  const ctx = getCtx();
  if (!ctx) return;
  ensureRunning(ctx);

  const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
  notes.forEach((freq, i) => {
    playTone(ctx, {
      freq,
      startOffset: i * 0.07,
      duration: 0.18,
      peakGain: 0.16,
      type: "sine",
    });
  });
}

/**
 * Avión perdido: tono cayendo de 440 Hz a 220 Hz. Suena a "fallo".
 */
export function playLostSound() {
  if (muted) return;
  const ctx = getCtx();
  if (!ctx) return;
  ensureRunning(ctx);

  playTone(ctx, {
    freq: 440,
    pitchEnd: 220,
    startOffset: 0,
    duration: 0.45,
    peakGain: 0.2,
    type: "sine",
    filterFreq: 1800,
  });
  // Capa grave que da peso
  playTone(ctx, {
    freq: 165,
    startOffset: 0,
    duration: 0.5,
    peakGain: 0.1,
    type: "sine",
  });
}

/**
 * Game over: bajo cinematográfico cayendo lentamente.
 */
let voiceBusy = false;

/**
 * Voz sintética (Web Speech API) para confirmación del piloto al rescatar.
 */
export function speakPilotLine(text, { rate = 0.92, pitch = 0.85 } = {}) {
  if (muted || !text) return Promise.resolve();
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = rate;
    u.pitch = pitch;
    u.volume = 0.85;
    const voices = window.speechSynthesis.getVoices();
    const en =
      voices.find((v) => /en(-|_)(US|GB)/i.test(v.lang) && /male/i.test(v.name)) ||
      voices.find((v) => v.lang.startsWith("en"));
    if (en) u.voice = en;
    voiceBusy = true;
    u.onend = () => {
      voiceBusy = false;
      resolve();
    };
    u.onerror = () => {
      voiceBusy = false;
      resolve();
    };
    window.speechSynthesis.speak(u);
  });
}

export function speakPilotAccept(callsign) {
  const cs = (callsign || "aircraft").replace(/[^a-zA-Z0-9 ]/g, "").trim();
  return speakPilotLine(`${cs}. Roger. Executing evasion turn now.`, {
    rate: 1,
    pitch: 0.95,
  });
}

export function isVoiceBusy() {
  return voiceBusy;
}

export function playGameOverSound() {
  if (muted) return;
  const ctx = getCtx();
  if (!ctx) return;
  ensureRunning(ctx);

  playTone(ctx, {
    freq: 220,
    pitchEnd: 80,
    startOffset: 0,
    duration: 1.6,
    peakGain: 0.22,
    type: "sine",
    filterFreq: 1200,
  });
  // Quinta justa para acentuar la profundidad
  playTone(ctx, {
    freq: 165,
    pitchEnd: 60,
    startOffset: 0.05,
    duration: 1.6,
    peakGain: 0.14,
    type: "sine",
  });
}
