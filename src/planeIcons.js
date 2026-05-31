// SVG silhouettes por categoría de aeronave.
// Todos diseñados apuntando hacia ARRIBA (norte). El billboard del entity
// rota la imagen según el heading del vuelo (-heading_radians) para que la
// silueta apunte en la dirección de movimiento, estilo radar de torre.
//
// Las siluetas usan fill blanco + stroke negro: el `color` del billboard
// las tinta multiplicativamente al color de la categoría correspondiente.
//
// Importante: las SVGs incluyen width/height EXPLÍCITOS para evitar que
// Cesium las renderice como cuadrados negros cuando el viewBox no es
// suficiente para inferir el tamaño.

const SIZE = 128;

const SVG_HEADER = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-50 -50 100 100' width='${SIZE}' height='${SIZE}'>`;

const PLANE_SVG = `${SVG_HEADER}<path d='M 0 -42 L 6 -10 L 44 6 L 44 12 L 6 8 L 6 28 L 18 36 L 18 40 L 0 36 L -18 40 L -18 36 L -6 28 L -6 8 L -44 12 L -44 6 L -6 -10 Z' fill='white' stroke='black' stroke-width='3' stroke-linejoin='round'/></svg>`;

const HEAVY_SVG = `${SVG_HEADER}<path d='M 0 -44 L 8 -8 L 48 8 L 48 14 L 8 10 L 8 28 L 22 38 L 22 42 L 0 38 L -22 42 L -22 38 L -8 28 L -8 10 L -48 14 L -48 8 L -8 -8 Z' fill='white' stroke='black' stroke-width='3.5' stroke-linejoin='round'/></svg>`;

const LIGHT_SVG = `${SVG_HEADER}<path d='M 0 -36 L 5 -8 L 38 4 L 38 9 L 5 6 L 5 22 L 14 30 L 14 34 L 0 30 L -14 34 L -14 30 L -5 22 L -5 6 L -38 9 L -38 4 L -5 -8 Z' fill='white' stroke='black' stroke-width='2.5' stroke-linejoin='round'/></svg>`;

const ROTOR_SVG = `${SVG_HEADER}<line x1='-44' y1='0' x2='44' y2='0' stroke='white' stroke-width='5'/><line x1='-44' y1='0' x2='44' y2='0' stroke='black' stroke-width='1.2'/><line x1='0' y1='-44' x2='0' y2='44' stroke='white' stroke-width='5'/><line x1='0' y1='-44' x2='0' y2='44' stroke='black' stroke-width='1.2'/><circle cx='0' cy='0' r='15' fill='white' stroke='black' stroke-width='3'/><rect x='-3' y='10' width='6' height='30' fill='white' stroke='black' stroke-width='2'/></svg>`;

const GLIDER_SVG = `${SVG_HEADER}<path d='M 0 -38 L 4 -6 L 48 -1 L 48 5 L 4 9 L 0 32 L -4 9 L -48 5 L -48 -1 L -4 -6 Z' fill='white' stroke='black' stroke-width='2.5' stroke-linejoin='round'/></svg>`;

const BALLOON_SVG = `${SVG_HEADER}<circle cx='0' cy='0' r='30' fill='white' stroke='black' stroke-width='3'/><line x1='-22' y1='-22' x2='22' y2='22' stroke='black' stroke-width='2'/><line x1='-22' y1='22' x2='22' y2='-22' stroke='black' stroke-width='2'/><circle cx='0' cy='0' r='6' fill='black'/></svg>`;

const DRONE_SVG = `${SVG_HEADER}<line x1='-32' y1='-32' x2='32' y2='32' stroke='white' stroke-width='6'/><line x1='-32' y1='-32' x2='32' y2='32' stroke='black' stroke-width='2'/><line x1='32' y1='-32' x2='-32' y2='32' stroke='white' stroke-width='6'/><line x1='32' y1='-32' x2='-32' y2='32' stroke='black' stroke-width='2'/><circle cx='-32' cy='-32' r='10' fill='white' stroke='black' stroke-width='2'/><circle cx='32' cy='-32' r='10' fill='white' stroke='black' stroke-width='2'/><circle cx='-32' cy='32' r='10' fill='white' stroke='black' stroke-width='2'/><circle cx='32' cy='32' r='10' fill='white' stroke='black' stroke-width='2'/><circle cx='0' cy='0' r='8' fill='white' stroke='black' stroke-width='2'/></svg>`;

const ROCKET_SVG = `${SVG_HEADER}<path d='M 0 -44 L 10 -22 L 10 22 L 22 34 L 22 44 L -22 44 L -22 34 L -10 22 L -10 -22 Z' fill='white' stroke='black' stroke-width='3' stroke-linejoin='round'/><circle cx='0' cy='-15' r='4' fill='black'/></svg>`;

/**
 * Convierte una cadena SVG a una data URL PNG renderizándola en un canvas.
 * Esto es más robusto para Cesium que `data:image/svg+xml;base64,...` porque
 * no depende del soporte de SVG dentro del pipeline de imágenes de Cesium.
 *
 * Devuelve una Promise<string> ya que el load del Image es async, pero
 * cacheamos sincrónicamente el placeholder transparente y lo reemplazamos
 * cuando termina de renderizar.
 */
function svgToPngSync(svg) {
  // Usamos data URL SVG directamente. Modernos browsers + Cesium aceptan
  // SVG en billboards CON tal de que tenga dimensiones explícitas.
  // El SIZE en el SVG header garantiza eso.
  const utf8 = encodeURIComponent(svg)
    .replace(/'/g, "%27")
    .replace(/"/g, "%22");
  return `data:image/svg+xml;charset=utf-8,${utf8}`;
}

const ICON_CACHE = {
  plane: svgToPngSync(PLANE_SVG),
  heavy: svgToPngSync(HEAVY_SVG),
  light: svgToPngSync(LIGHT_SVG),
  rotor: svgToPngSync(ROTOR_SVG),
  glider: svgToPngSync(GLIDER_SVG),
  balloon: svgToPngSync(BALLOON_SVG),
  drone: svgToPngSync(DRONE_SVG),
  rocket: svgToPngSync(ROCKET_SVG),
};

/**
 * Devuelve la data URL de la silueta para una categoría de aeronave.
 * Mapping de tipos OpenSky → silueta visual.
 */
export function iconForCategory(cat) {
  switch (cat) {
    case "rotor":
      return ICON_CACHE.rotor;
    case "glider":
      return ICON_CACHE.glider;
    case "balloon":
      return ICON_CACHE.balloon;
    case "uav":
      return ICON_CACHE.drone;
    case "space":
      return ICON_CACHE.rocket;
    case "light":
    case "ultralight":
      return ICON_CACHE.light;
    case "heavy":
    case "high_vortex":
      return ICON_CACHE.heavy;
    default:
      return ICON_CACHE.plane;
  }
}
