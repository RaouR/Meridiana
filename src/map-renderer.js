/**
 * map-renderer.js — Loads the Mercator SVG, sets up panzoom,
 * handles click-to-place pin with inverse-scale logic.
 */

import panzoom from 'panzoom';
import { pixelToLatLng, MAP_SIZE } from './geo.js';

let panzoomInstance = null;
let svgEl = null;
let mapGroup = null;
let pinGroup = null;
let currentPin = null;          // { lat, lng, svgX, svgY }
let onPinPlacedCallback = null; // called when pin is placed / moved

/* ------------------------------------------------------------------ */
/*  Initialise                                                        */
/* ------------------------------------------------------------------ */

/**
 * Load map.svg, inject into the container, and wire up panzoom + click.
 * @param {string} containerId  – DOM id of the map wrapper
 * @param {function} onPinPlaced – callback({lat, lng}) when pin is placed
 */
export async function initMap(containerId, onPinPlaced) {
    const container = document.getElementById(containerId);
    if (!container) throw new Error(`Container #${containerId} not found`);

    onPinPlacedCallback = onPinPlaced;

    // Fetch and inject the SVG
    const resp = await fetch('/map.svg');
    const svgText = await resp.text();
    container.innerHTML = svgText;

    svgEl = container.querySelector('svg');
    svgEl.setAttribute('id', 'world-map');
    svgEl.style.width = '100%';
    svgEl.style.height = '100%';

    // Wrap all existing content in a pannable group
    mapGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    mapGroup.setAttribute('id', 'map-group');
    while (svgEl.firstChild) mapGroup.appendChild(svgEl.firstChild);
    svgEl.appendChild(mapGroup);

    // Create pin group (inside mapGroup so it pans/zooms with the map)
    pinGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    pinGroup.setAttribute('id', 'pin-group');
    pinGroup.style.display = 'none';
    mapGroup.appendChild(pinGroup);

    // Pin visuals: a circle + stem line
    const pinLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    pinLine.setAttribute('x1', 0);
    pinLine.setAttribute('y1', 0);
    pinLine.setAttribute('x2', 0);
    pinLine.setAttribute('y2', -18);
    pinLine.setAttribute('class', 'pin-stem');

    const pinCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    pinCircle.setAttribute('cx', 0);
    pinCircle.setAttribute('cy', -18);
    pinCircle.setAttribute('r', 6);
    pinCircle.setAttribute('class', 'pin-head');

    const pinDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    pinDot.setAttribute('cx', 0);
    pinDot.setAttribute('cy', 0);
    pinDot.setAttribute('r', 2.5);
    pinDot.setAttribute('class', 'pin-dot');

    pinGroup.appendChild(pinLine);
    pinGroup.appendChild(pinCircle);
    pinGroup.appendChild(pinDot);

    // Panzoom — apply to the map group
    panzoomInstance = panzoom(mapGroup, {
        maxZoom: 20,
        minZoom: 0.8,
        smoothScroll: false,
        zoomDoubleClickSpeed: 1,   // disable double-click zoom
        filterKey: () => true,     // allow all keys
    });

    // Update pin scale on every transform
    panzoomInstance.on('transform', () => updatePinScale());

    // Click detection (distinguish click from pan)
    let pointerDown = null;
    svgEl.addEventListener('pointerdown', (e) => {
        pointerDown = { x: e.clientX, y: e.clientY };
    });
    svgEl.addEventListener('pointerup', (e) => {
        if (!pointerDown) return;
        const dx = Math.abs(e.clientX - pointerDown.x);
        const dy = Math.abs(e.clientY - pointerDown.y);
        if (dx < 5 && dy < 5) handleMapClick(e);
        pointerDown = null;
    });

    // Set sensible initial zoom to fill width
    requestAnimationFrame(() => fitMapToContainer(container));
}

/* ------------------------------------------------------------------ */
/*  Coordinate helpers (screen → SVG map space)                       */
/* ------------------------------------------------------------------ */

function screenToMapCoords(clientX, clientY) {
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    // getScreenCTM on mapGroup includes viewBox + panzoom transforms
    const ctm = mapGroup.getScreenCTM().inverse();
    const mapPt = pt.matrixTransform(ctm);
    return { x: mapPt.x, y: mapPt.y };
}

/* ------------------------------------------------------------------ */
/*  Click → place pin                                                */
/* ------------------------------------------------------------------ */

function handleMapClick(e) {
    const { x, y } = screenToMapCoords(e.clientX, e.clientY);

    // Bounds check
    if (x < 0 || x > MAP_SIZE || y < 0 || y > MAP_SIZE) return;

    const { lat, lng } = pixelToLatLng(x, y);
    currentPin = { lat, lng, svgX: x, svgY: y };

    // Position the pin
    pinGroup.style.display = '';
    pinGroup.setAttribute(
        'transform',
        `translate(${x}, ${y}) scale(${1 / getScale()})`,
    );

    if (onPinPlacedCallback) onPinPlacedCallback({ lat, lng });
}

/* ------------------------------------------------------------------ */
/*  Pin scale (constant screen size)                                  */
/* ------------------------------------------------------------------ */

function getScale() {
    return panzoomInstance ? panzoomInstance.getTransform().scale : 1;
}

function updatePinScale() {
    if (!currentPin) return;
    const s = 1 / getScale();
    pinGroup.setAttribute(
        'transform',
        `translate(${currentPin.svgX}, ${currentPin.svgY}) scale(${s})`,
    );
}

/* ------------------------------------------------------------------ */
/*  Fit map to container on load                                      */
/* ------------------------------------------------------------------ */

function fitMapToContainer(container) {
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const desiredScale = cw / MAP_SIZE;
    const yOffset = (ch - MAP_SIZE * desiredScale) / 2;
    panzoomInstance.zoomAbs(0, 0, desiredScale);
    panzoomInstance.moveTo(0, yOffset);
}

/* ------------------------------------------------------------------ */
/*  Public helpers                                                     */
/* ------------------------------------------------------------------ */

export function getPin() {
    return currentPin;
}

export function clearPin() {
    currentPin = null;
    if (pinGroup) pinGroup.style.display = 'none';
}

export function setPinColor(color) {
    if (!pinGroup) return;
    const head = pinGroup.querySelector('.pin-head');
    const dot = pinGroup.querySelector('.pin-dot');
    if (head) head.setAttribute('fill', color);
    if (dot) dot.setAttribute('fill', color);
}
