/**
 * geo.js — Mercator projection math, Haversine distance, directional feedback.
 * All coordinate math uses a square Mercator map of MAP_SIZE × MAP_SIZE pixels.
 */

import { countryBoundaries } from './map-data.js';

export const MAP_SIZE = 1000;
export const MAX_LAT = 85.0511;

/* ------------------------------------------------------------------ */
/*  Mercator  ↔  Lat/Lng                                              */
/* ------------------------------------------------------------------ */

/**
 * Convert SVG pixel coordinates to geographic lat/lng.
 * Uses inverse Mercator (Gudermannian).
 */
export function pixelToLatLng(px, py) {
  const lng = (px / MAP_SIZE) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / MAP_SIZE)));
  const lat = (latRad * 180) / Math.PI;
  return { lat, lng };
}

/**
 * Convert geographic lat/lng to SVG pixel coordinates.
 * Uses forward Mercator projection.
 */
export function latLngToPixel(lat, lng) {
  const x = ((lng + 180) / 360) * MAP_SIZE;
  const clampedLat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  const y =
    MAP_SIZE / 2 -
    (MAP_SIZE / (2 * Math.PI)) *
    Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  return { x, y };
}

/* ------------------------------------------------------------------ */
/*  Hit Detection (Ray Casting)                                        */
/* ------------------------------------------------------------------ */

/**
 * Detect which country (ISO code) is at a given Lat/Lng.
 */
export function getCountryAt(lat, lng) {
  for (const [iso, polygons] of Object.entries(countryBoundaries)) {
    for (const polygon of polygons) {
      if (isPointInPolygon(lng, lat, polygon)) {
        return iso;
      }
    }
  }
  return null;
}

/**
 * Ray casting algorithm for point-in-polygon test.
 */
function isPointInPolygon(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];

    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/* ------------------------------------------------------------------ */
/*  Haversine distance (km)                                           */
/* ------------------------------------------------------------------ */

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ------------------------------------------------------------------ */
/*  Directional feedback                                              */
/* ------------------------------------------------------------------ */

export function feedback(guessLat, guessLng, targetLat, targetLng) {
  const dLat = targetLat - guessLat;
  const dLng = targetLng - guessLng;
  const distKm = haversineKm(guessLat, guessLng, targetLat, targetLng);

  const ns =
    Math.abs(dLat) < 1
      ? ''
      : dLat > 0
        ? `${Math.abs(dLat).toFixed(0)}° too far South`
        : `${Math.abs(dLat).toFixed(0)}° too far North`;

  const ew =
    Math.abs(dLng) < 1
      ? ''
      : dLng > 0
        ? `${Math.abs(dLng).toFixed(0)}° too far West`
        : `${Math.abs(dLng).toFixed(0)}° too far East`;

  return { distKm, ns, ew };
}

/* ------------------------------------------------------------------ */
/*  Distance tier classifier                                          */
/* ------------------------------------------------------------------ */

export function distanceTier(km) {
  if (km < 50) return { label: 'Bullseye', color: '#ffd700', emoji: '⭐' };
  if (km < 200) return { label: 'Win', color: '#0ead69', emoji: '🟩' };
  if (km < 1000) return { label: 'Close', color: '#e8d44d', emoji: '🟨' };
  if (km < 3000) return { label: 'Warm', color: '#f4a261', emoji: '🟧' };
  return { label: 'Far', color: '#e94560', emoji: '🟥' };
}
