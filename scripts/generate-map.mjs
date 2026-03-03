/**
 * generate-map.mjs — Fetches world GeoJSON, simplifies it via TopoJSON,
 * and converts to a Mercator SVG.
 *
 * Usage:  node scripts/generate-map.mjs
 * Output: public/map.svg
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
    console.log('⏳  Simplifying geometry (Topology-preserving)…');

    // 1. Convert to TopoJSON (this merges shared borders)
    const topology = topojsonServer.topology({ countries: geo });

    // 2. Simplify using Visvalingam’s algorithm
    const simplifiedTopology = topojsonSimplify.presimplify(topology);

    // Target ~90-95% reduction for map performance.
    // 0.05 quantile keeps the top 5% most significant points.
    const threshold = topojsonSimplify.quantile(simplifiedTopology, 0.05);
    const simpler = topojsonSimplify.simplify(simplifiedTopology, threshold);

    // 3. Convert back to GeoJSON features
    const simplifiedGeo = topojsonClient.feature(simpler, simpler.objects.countries);
    console.log(`   Geometry simplified.`);

    let paths = '';
    let count = 0;
    let totalPoints = 0;

    for (const feature of simplifiedGeo.features) {
        const props = feature.properties || {};
        const iso =
            props.ISO_A2 ||
            props.ISO_A3 ||
            props.iso_a2 ||
            props.iso_a3 ||
            props.ISO ||
            props.ADM0_A3 ||
            'XX';
        const geom = feature.geometry;
        if (!geom) continue;

        let d = '';

        if (geom.type === 'Polygon') {
            d = geom.coordinates.map(ringToPathData).join('');
            geom.coordinates.forEach(ring => totalPoints += ring.length);
        } else if (geom.type === 'MultiPolygon') {
            d = geom.coordinates
                .map((poly) => poly.map(ringToPathData).join(''))
                .join('');
            geom.coordinates.forEach(poly => poly.forEach(ring => totalPoints += ring.length));
        }

        if (d) {
            paths += `  <path class="country" data-id="${iso}" d="${d}"/>\n`;
            count++;
        }
    }

    const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_SIZE} ${MAP_SIZE}" preserveAspectRatio="xMidYMid meet">`,
        `<rect width="${MAP_SIZE}" height="${MAP_SIZE}" fill="#0f0f1a"/>`,
        `<g id="countries">`,
        paths,
        `</g>`,
        `</svg>`,
    ].join('\n');

    const outDir = join(ROOT, 'public');
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, 'map.svg');
    writeFileSync(outPath, svg);

    const sizeKB = (Buffer.byteLength(svg) / 1024).toFixed(0);
    console.log(`✅  ${count} countries → public/map.svg (${sizeKB} KB)`);
    console.log(`📊  Total simplified points: ${totalPoints}`);
}

main().catch((err) => {
    console.error('❌  Generation failed:', err);
    process.exit(1);
});
