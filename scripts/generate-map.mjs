import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as topojsonServer from 'topojson-server';
import * as topojsonSimplify from 'topojson-simplify';
import * as topojsonClient from 'topojson-client';
import { createCanvas } from 'canvas';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const GEOJSON_URL =
    'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';

const MAP_SIZE = 4000;
const MAX_LAT = 85.0511;

// Colors
const COLOR_BG = '#0f0f1a';
const COLOR_LAND = '#1a1a2e';
const COLOR_BORDER = '#2a2a4a';

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
    return [x, y];
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

    // Canvas Setup
    const canvas = createCanvas(MAP_SIZE, MAP_SIZE);
    const ctx = canvas.getContext('2d');

    // Draw Background
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    let countryBoundaries = {};
    let count = 0;
    let totalPoints = 0;

    ctx.fillStyle = COLOR_LAND;
    ctx.strokeStyle = COLOR_BORDER;
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';

    for (const feature of simplifiedGeo.features) {
        const props = feature.properties || {};
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

        if (!countryBoundaries[iso]) countryBoundaries[iso] = [];

        const processRing = (ring) => {
            totalPoints += ring.length;
            const points = ring.map(coord => mercator(coord[0], coord[1]));
            countryBoundaries[iso].push(points);

            if (points.length < 2) return;

            ctx.beginPath();
            ctx.moveTo(points[0][0], points[0][1]);
            for (let i = 1; i < points.length; i++) {
                ctx.lineTo(points[i][0], points[i][1]);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        };

        if (geom.type === 'Polygon') {
            geom.coordinates.forEach(processRing);
        } else if (geom.type === 'MultiPolygon') {
            geom.coordinates.forEach((poly) => {
                poly.forEach(processRing);
            });
        }
        count++;
    }

    const outDir = join(ROOT, 'public');
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    // 1. Write public/map.png
    const buffer = canvas.toBuffer('image/png');
    writeFileSync(join(outDir, 'map.png'), buffer);

    // 2. Write src/map-data.js (Hit Detection Data) - using pre-projected coords for faster UI highlighting
    const dataContent = `/**\n * Auto-generated map data for hit detection and highlighting.\n */\n\nexport const countryBoundaries = ${JSON.stringify(countryBoundaries)};\n`;
    writeFileSync(join(ROOT, 'src', 'map-data.js'), dataContent);

    const sizePNG = (buffer.length / 1024).toFixed(0);
    const sizeJS = (Buffer.byteLength(dataContent) / 1024).toFixed(0);
    console.log(`✅  ${count} countries rendered → public/map.png (${sizePNG} KB)`);
    console.log(`✅  Hit data generated → src/map-data.js (${sizeJS} KB)`);
    console.log(`📊  Simplified points: ${totalPoints}`);
}

main().catch((err) => {
    console.error('❌  Generation failed:', err);
    process.exit(1);
});
