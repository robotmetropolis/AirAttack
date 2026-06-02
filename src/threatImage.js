// Carga y procesa imágenes de amenazas.
//
// Convención: cada amenaza intenta cargar `public/threats/<id_lowercase>.png`
// (o .jpg / .webp). Si el archivo existe, le aplicamos un "chroma key"
// automático: sampleamos el color de fondo desde el perímetro (con mediana
// para resistir texto u otros artefactos en los bordes) y hacemos
// transparente cualquier pixel cercano a ese color.
//
// El resultado se sirve como dataURL listo para usar en `<img src>`.
// Si no existe el archivo, devolvemos null y el caller usa el emoji.

const cache = new Map(); // id -> Promise<dataURL | null>

const BASE_URL = (import.meta.env.BASE_URL || "/") + "threats/";

const FORMATS = ["png", "jpg", "jpeg", "webp"];

// Tamaño máximo del lado largo. Mantiene RAM bajo control y acelera el
// procesamiento; 320 alcanza para que se vean nítidas con escala 1.7x en
// pantalla (~80 * 1.7 ≈ 136px efectivos).
const MAX_SIDE_PX = 320;

// Distancia (en RGB euclídeo, 0..441) por debajo de la cual un pixel se
// considera fondo. FULL_DIST = totalmente transparente; PARTIAL_DIST = fade
// gradual. Valores bastante conservadores para no comer detalles del dibujo.
const FULL_DIST = 30;
const PARTIAL_DIST = 75;

/**
 * Intenta cargar la imagen de una amenaza y devuelve un dataURL con el
 * fondo hecho transparente, o null si no encuentra archivo.
 */
export async function loadThreatImage(threatId) {
  if (!threatId) return null;
  if (cache.has(threatId)) return cache.get(threatId);

  const lower = String(threatId).toLowerCase();
  const promise = tryLoadFormats(lower);
  cache.set(threatId, promise);
  return promise;
}

async function tryLoadFormats(idLower) {
  for (const fmt of FORMATS) {
    const url = `${BASE_URL}${idLower}.${fmt}`;
    try {
      const img = await loadImage(url);
      return processImage(img);
    } catch {
      // Probar siguiente extensión
    }
  }
  return null;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed: ${url}`));
    img.src = url;
  });
}

/**
 * Pinta la imagen en un canvas, sampleamos el color de fondo desde el
 * perímetro, hacemos transparente lo cercano a ese color con fade gradual,
 * y devolvemos un dataURL PNG.
 */
function processImage(img) {
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (w > MAX_SIDE_PX || h > MAX_SIDE_PX) {
    const ratio = Math.min(MAX_SIDE_PX / w, MAX_SIDE_PX / h);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  const id = ctx.getImageData(0, 0, w, h);
  const data = id.data;

  // 1. Sampling del color de fondo desde el perímetro. Tomamos N puntos
  //    a lo largo de cada borde y nos quedamos con la MEDIANA de cada
  //    canal (más robusto a artefactos como el texto del nombre).
  const N = 32;
  const reds = [];
  const greens = [];
  const blues = [];
  const samplePixel = (x, y) => {
    const i = (y * w + x) * 4;
    reds.push(data[i]);
    greens.push(data[i + 1]);
    blues.push(data[i + 2]);
  };
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const x = Math.round(t * (w - 1));
    const y = Math.round(t * (h - 1));
    samplePixel(x, 0);
    samplePixel(x, h - 1);
    samplePixel(0, y);
    samplePixel(w - 1, y);
  }
  const bgR = median(reds);
  const bgG = median(greens);
  const bgB = median(blues);

  // 2. Recorrer pixeles. Distancia euclídea al color de fondo determina
  //    cuánto desvanecemos el alpha.
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const dr = r - bgR;
    const dg = g - bgG;
    const db = b - bgB;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);

    if (dist < FULL_DIST) {
      data[i + 3] = 0;
    } else if (dist < PARTIAL_DIST) {
      const t = (dist - FULL_DIST) / (PARTIAL_DIST - FULL_DIST);
      data[i + 3] = Math.round(data[i + 3] * t);
    }
  }

  ctx.putImageData(id, 0, 0);
  return canvas.toDataURL("image/png");
}

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
