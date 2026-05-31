// Capas de imagery alternativas (sin token de Cesium Ion).
// Permite alternar entre satélite, dark, light, OSM, topográfico.
//
// Todos son gratis y públicos. Al usar para más que dev casero, considerá
// respetar las políticas de uso de cada proveedor (atribución, rate limits).

import * as Cesium from "cesium";

export const IMAGERY_PROVIDERS = {
  TOPO: {
    label: "⛰️",
    name: "Topográfico",
    create: () =>
      new Cesium.UrlTemplateImageryProvider({
        url: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
        maximumLevel: 17,
        credit: "© OpenTopoMap (CC-BY-SA)",
      }),
  },
  OSM: {
    label: "🌍",
    name: "OSM (liviano)",
    create: () =>
      new Cesium.UrlTemplateImageryProvider({
        url: "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        maximumLevel: 19,
        credit: "© OpenStreetMap contributors",
      }),
  },
  DARK: {
    label: "🌑",
    name: "Dark Matter",
    create: () =>
      new Cesium.UrlTemplateImageryProvider({
        url: "https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}@2x.png",
        subdomains: "abcd",
        maximumLevel: 18,
        credit: "© OpenStreetMap, © CARTO",
      }),
  },
  VOYAGER: {
    label: "🗺️",
    name: "Voyager",
    create: () =>
      new Cesium.UrlTemplateImageryProvider({
        url: "https://cartodb-basemaps-{s}.global.ssl.fastly.net/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        subdomains: "abcd",
        maximumLevel: 18,
        credit: "© CARTO",
      }),
  },
  ESRI: {
    label: "🛰️",
    name: "Satélite",
    create: () =>
      new Cesium.UrlTemplateImageryProvider({
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        maximumLevel: 19,
        credit: "© Esri, Maxar",
      }),
  },
};

/**
 * Reemplaza la base layer del viewer por el provider con la key dada.
 * Limpia todas las layers anteriores antes.
 */
export function setBaseLayer(viewer, key) {
  const provider = IMAGERY_PROVIDERS[key];
  if (!provider) {
    console.warn(`[imagery] provider desconocido: ${key}`);
    return;
  }
  const layers = viewer.scene.imageryLayers;
  while (layers.length > 0) {
    layers.remove(layers.get(0));
  }
  layers.addImageryProvider(provider.create());
  console.log(`[imagery] base layer cambiada a ${provider.name}`);
}
