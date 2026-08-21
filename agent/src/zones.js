/** Géométrie des zones de l'enclos, en coordonnées normalisées 0-1. */

/** Test d'appartenance à un polygone (algorithme du lancer de rayon). */
export function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Nom de la zone contenant le point, ou `null` (= dehors / zone non définie). */
export function zoneAt(x, y, zones) {
  for (const zone of zones) {
    if (zone.polygon?.length >= 3 && pointInPolygon(x, y, zone.polygon)) return zone.name;
  }
  return null;
}

/**
 * Construit un masque booléen à la résolution d'analyse : les pixels couverts
 * par un polygone de `mask` sont ignorés par la détection de mouvement (utile
 * pour exclure une fenêtre, un reflet d'eau ou une plante qui bouge).
 */
export function buildMask(maskPolygons, width, height) {
  if (!maskPolygons || maskPolygons.length === 0) return null;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = (x + 0.5) / width;
      const ny = (y + 0.5) / height;
      const ignored = maskPolygons.some((polygon) => pointInPolygon(nx, ny, polygon));
      mask[y * width + x] = ignored ? 1 : 0;
    }
  }
  return mask;
}
