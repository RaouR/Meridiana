/**
 * main.js — Entry point for Meridiana.
 * Task 1: Wires up the map, pin placement, and coordinate display.
 */

import './style.css';
import { initMap, getPin, clearPin } from './map-renderer.js';
import { haversineKm, feedback, distanceTier, getCountryAt } from './geo.js';

const coordsDisplay = document.getElementById('coordinates-display');
const submitBtn = document.getElementById('submit-guess');

/* ------------------------------------------------------------------ */
/*  Boot                                                               */
/* ------------------------------------------------------------------ */

initMap('map-container', onPinPlaced).catch((err) => {
  console.error('Failed to initialise map:', err);
});

/* ------------------------------------------------------------------ */
/*  Pin placed callback                                                */
/* ------------------------------------------------------------------ */

function onPinPlaced({ lat, lng }) {
  const countryCode = getCountryAt(lat, lng);
  const locationText = countryCode ? ` [${countryCode}]` : '';
  coordsDisplay.textContent = `📍 ${lat.toFixed(4)}°, ${lng.toFixed(4)}°${locationText}`;
  submitBtn.disabled = false;
}

/* ------------------------------------------------------------------ */
/*  Submit guess (placeholder — full logic in Task 4)                  */
/* ------------------------------------------------------------------ */

submitBtn.addEventListener('click', () => {
  const pin = getPin();
  if (!pin) return;

  coordsDisplay.textContent =
    `✅ Submitted: ${pin.lat.toFixed(4)}°, ${pin.lng.toFixed(4)}°`;
  submitBtn.disabled = true;

  // Reset pin after a short delay (placeholder for real game flow)
  setTimeout(() => {
    clearPin();
    coordsDisplay.textContent = 'Click the map to place a pin.';
  }, 2000);
});
