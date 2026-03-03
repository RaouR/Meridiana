/**
 * generate-map.mjs — Fetches world GeoJSON, simplifies it via TopoJSON,
 * merges geometries into a single SVG path, and exports hit-detection data.
 *
 * Usage:  node scripts/generate-map.mjs
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as topojsonServer from 'topojson-server';
import * as topojsonSimplify from 'topojson-simplify';
import * as topojsonClient from 'topojson-client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const GEOJSON_URL =
    'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';

const MAP_SIZE = 1000;
const MAX_LAT = 85.0511;

/* ------------------------------------------------------------------ */
/*  Mercator projection                                                */
/* ------------------------------------------------------------------ */

function mercator(lng, lat) {
    const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
    const x = ((lng + 180) / 360) * MAP_SIZE;
    const latRad = (clamped * Math.PI) / 180;
    const y =
        MAP_SIZE / 2 -
        (MAP_SIZE / (2 * Math.PI)) *
        Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
}

/* ------------------------------------------------------------------ */
/*  Ring → SVG path data                                               */
/* ------------------------------------------------------------------ */

function ringToPathData(ring) {
    return ring
        .map((coord, i) => {
            const [x, y] = mercator(coord[0], coord[1]);
            return `${i === 0 ? 'M' : 'L'}${x},${y}`;
        })
        .join('') + 'Z';
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
    console.log('⏳  Fetching GeoJSON…');
    const resp = await fetch(GEOJSON_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const geo = await resp.json();
    console.log(`   ${geo.features.length} features loaded.`);

    console.log('⏳  Simplifying geometry (Topology-preserving)…');

    // 1. Convert to TopoJSON
    const topology = topojsonServer.topology({ countries: geo });

    // 2. Simplify using Visvalingam’s algorithm
    const simplifiedTopology = topojsonSimplify.presimplify(topology);

    // Using 0.07 as requested (keeps the top 7% most significant points)
    const threshold = topojsonSimplify.quantile(simplifiedTopology, 0.07);
    const simpler = topojsonSimplify.simplify(simplifiedTopology, threshold);

    // 3. Convert back to GeoJSON features
    const simplifiedGeo = topojsonClient.feature(simpler, simpler.objects.countries);
    console.log(`   Geometry simplified.`);

    let allPathData = '';
    let countryBoundaries = {};
    let count = 0;
    let totalPoints = 0;

    for (const feature of simplifiedGeo.features) {
        const props = feature.properties || {};
        // Use properties found in this specific dataset
        const iso =
            props['ISO3166-1-Alpha-2'] ||
            props['ISO3166-1-Alpha-3'] ||
            props.ISO_A2 ||
            props.ISO_A3 ||
            props.iso_a2 ||
            props.iso_a3 ||
            props.name ||
            'Unknown';

        const geom = feature.geometry;
        if (!geom) continue;

        // Ensure we handle collisions or multiple polygons for the same ISO
        if (!countryBoundaries[iso]) countryBoundaries[iso] = [];

        if (geom.type === 'Polygon') {
            allPathData += geom.coordinates.map(ringToPathData).join('');
            geom.coordinates.forEach(ring => {
                totalPoints += ring.length;
                countryBoundaries[iso].push(ring);
            });
        } else if (geom.type === 'MultiPolygon') {
            geom.coordinates.forEach((poly) => {
                allPathData += poly.map(ringToPathData).join('');
                poly.forEach(ring => {
                    totalPoints += ring.length;
                    countryBoundaries[iso].push(ring);
                });
            });
        }
        count++;
    }

    // 1. Write public/map.svg (Merged Path)
    const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_SIZE} ${MAP_SIZE}" preserveAspectRatio="xMidYMid meet">`,
        `<rect width="${MAP_SIZE}" height="${MAP_SIZE}" fill="#0f0f1a"/>`,
        `<g id="countries">`,
        `  <path class="world-map" d="${allPathData}"/>`,
        `</g>`,
        `</svg>`,
    ].join('\n');

    const outDir = join(ROOT, 'public');
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'map.svg'), svg);

    // 2. Write src/map-data.js (Hit Detection Data)
    const dataContent = `/**\n * Auto-generated map data for hit detection.\n */\n\nexport const countryBoundaries = ${JSON.stringify(countryBoundaries)};\n`;
    writeFileSync(join(ROOT, 'src', 'map-data.js'), dataContent);

    const sizeSVG = (Buffer.byteLength(svg) / 1024).toFixed(0);
    const sizeJS = (Buffer.byteLength(dataContent) / 1024).toFixed(0);
    console.log(`✅  ${count} countries merged → public/map.svg (${sizeSVG} KB)`);
    console.log(`✅  Hit data generated → src/map-data.js (${sizeJS} KB)`);
    console.log(`📊  Simplified points: ${totalPoints}`);
}

main().catch((err) => {
    console.error('❌  Generation failed:', err);
    process.exit(1);
});
