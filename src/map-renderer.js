import panzoom from 'panzoom';
import { pixelToLatLng, MAP_SIZE } from './geo.js';
import { countryBoundaries } from './map-data.js';

let panzoomInstance = null;
let containerWrapper = null;
let mapImg = null;
let svgOverlay = null;
let highlightGroup = null;
let pinGroup = null;
let currentPin = null;          // { lat, lng, svgX, svgY }
let onPinPlacedCallback = null; // called when pin is placed / moved

/* ------------------------------------------------------------------ */
/*  Initialise                                                        */
/* ------------------------------------------------------------------ */

export async function initMap(containerId, onPinPlaced) {
    const container = document.getElementById(containerId);
    if (!container) throw new Error(`Container #${containerId} not found`);

    onPinPlacedCallback = onPinPlaced;

    // Create wrapper for img + svg
    containerWrapper = document.createElement('div');
    containerWrapper.setAttribute('id', 'map-wrapper');
    containerWrapper.style.position = 'relative';
    containerWrapper.style.width = `${MAP_SIZE}px`;
    containerWrapper.style.height = `${MAP_SIZE}px`;
    container.appendChild(containerWrapper);

    // Map Image
    mapImg = document.createElement('img');
    mapImg.src = '/map.png';
    mapImg.setAttribute('id', 'map-raster');
    mapImg.style.display = 'block';
    mapImg.style.width = '100%';
    mapImg.style.height = '100%';
    containerWrapper.appendChild(mapImg);

    // SVG Overlay
    svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgOverlay.setAttribute('id', 'map-overlay');
    svgOverlay.setAttribute('viewBox', `0 0 ${MAP_SIZE} ${MAP_SIZE}`);
    svgOverlay.style.position = 'absolute';
    svgOverlay.style.top = '0';
    svgOverlay.style.left = '0';
    svgOverlay.style.width = '100%';
    svgOverlay.style.height = '100%';
    svgOverlay.style.pointerEvents = 'none';
    containerWrapper.appendChild(svgOverlay);

    // Groups
    highlightGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    highlightGroup.setAttribute('id', 'highlight-group');
    svgOverlay.appendChild(highlightGroup);

    pinGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    pinGroup.setAttribute('id', 'pin-group');
    pinGroup.style.display = 'none';
    svgOverlay.appendChild(pinGroup);

    // Pin visuals
    const pinLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    pinLine.setAttribute('x1', 0); pinLine.setAttribute('y1', 0);
    pinLine.setAttribute('x2', 0); pinLine.setAttribute('y2', -40); // Scaled for 4000px
    pinLine.setAttribute('class', 'pin-stem');

    const pinCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    pinCircle.setAttribute('cx', 0); pinCircle.setAttribute('cy', -40);
    pinCircle.setAttribute('r', 12);
    pinCircle.setAttribute('class', 'pin-head');

    const pinDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    pinDot.setAttribute('cx', 0); pinDot.setAttribute('cy', 0);
    pinDot.setAttribute('r', 5);
    pinDot.setAttribute('class', 'pin-dot');

    pinGroup.appendChild(pinLine);
    pinGroup.appendChild(pinCircle);
    pinGroup.appendChild(pinDot);

    // Panzoom
    panzoomInstance = panzoom(containerWrapper, {
        maxZoom: 10,
        minZoom: 0.1,
        smoothScroll: false,
        zoomDoubleClickSpeed: 1,
        filterKey: () => true,
    });

    panzoomInstance.on('transform', () => updatePinScale());

    // Click detection
    let pointerDown = null;
    container.addEventListener('pointerdown', (e) => {
        pointerDown = { x: e.clientX, y: e.clientY };
    });
    container.addEventListener('pointerup', (e) => {
        if (!pointerDown) return;
        const dx = Math.abs(e.clientX - pointerDown.x);
        const dy = Math.abs(e.clientY - pointerDown.y);
        if (dx < 5 && dy < 5) handleMapClick(e);
        pointerDown = null;
    });

    requestAnimationFrame(() => fitMapToContainer(container));
}

/* ------------------------------------------------------------------ */
/*  Coordinate helpers                                                */
/* ------------------------------------------------------------------ */

function screenToMapCoords(clientX, clientY) {
    const rect = containerWrapper.getBoundingClientRect();
    const transform = panzoomInstance.getTransform();

    // Reverse the panzoom transform to get coords relative to the 4000x4000 space
    const x = (clientX - rect.left) / transform.scale;
    const y = (clientY - rect.top) / transform.scale;

    return { x, y };
}

/* ------------------------------------------------------------------ */
/*  Click → place pin                                                */
/* ------------------------------------------------------------------ */

function handleMapClick(e) {
    const { x, y } = screenToMapCoords(e.clientX, e.clientY);

    if (x < 0 || x > MAP_SIZE || y < 0 || y > MAP_SIZE) return;

    const { lat, lng } = pixelToLatLng(x, y);
    currentPin = { lat, lng, svgX: x, svgY: y };

    pinGroup.style.display = '';
    updatePinPosition();

    if (onPinPlacedCallback) onPinPlacedCallback({ lat, lng });
}

function updatePinPosition() {
    if (!currentPin) return;
    const s = 1 / getScale();
    pinGroup.setAttribute(
        'transform',
        `translate(${currentPin.svgX}, ${currentPin.svgY}) scale(${s})`,
    );
}

/* ------------------------------------------------------------------ */
/*  Highlighting                                                      */
/* ------------------------------------------------------------------ */

export function highlightCountry(iso) {
    highlightGroup.innerHTML = '';
    const polygons = countryBoundaries[iso];
    if (!polygons) return;

    polygons.forEach(ring => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const d = ring.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join('') + 'Z';
        path.setAttribute('d', d);
        path.setAttribute('class', 'highlight-path');
        highlightGroup.appendChild(path);
    });
}

export function clearHighlights() {
    highlightGroup.innerHTML = '';
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getScale() {
    return panzoomInstance ? panzoomInstance.getTransform().scale : 1;
}

function updatePinScale() {
    updatePinPosition();
}

function fitMapToContainer(container) {
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const desiredScale = cw / MAP_SIZE;
    const yOffset = (ch - MAP_SIZE * desiredScale) / 2;
    panzoomInstance.zoomAbs(0, 0, desiredScale);
    panzoomInstance.moveTo(0, yOffset);
}

export function getPin() { return currentPin; }

export function clearPin() {
    currentPin = null;
    if (pinGroup) pinGroup.style.display = 'none';
}

export function setPinColor(color) {
    if (!pinGroup) return;
    const head = pinGroup.querySelector('.pin-head');
    const dot = pinGroup.querySelector('.pin-dot');
    const stem = pinGroup.querySelector('.pin-stem');
    if (head) head.setAttribute('fill', color);
    if (dot) dot.setAttribute('fill', color);
    if (stem) stem.setAttribute('stroke', color);
}
