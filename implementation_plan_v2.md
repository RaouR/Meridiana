# Meridiana — Technical Requirement Document & Implementation Plan (v2)

> A geography-themed browser game where the player guesses the location of a city or landmark by clicking on a world map. Wordle-style daily challenge with a minimalist dark UI.

---

## 1. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| **Build tool** | **Vite 6** | Near-instant HMR, zero-config for vanilla JS, tiny production bundles |
| **Language** | **Vanilla JS (ES Modules)** | No framework overhead; the game is self-contained. Lightning-fast to build and maintain |
| **Styling** | **Vanilla CSS** with custom properties | Full dark-mode control, no build-time CSS tooling |
| **Map** | **Static Mercator SVG** + `panzoom` library | Shapes match mental models (Greenland, Africa); zoom/pan ensures mobile playability |
| **Map source** | [simplemaps world.svg](https://simplemaps.com/static/svg/world.svg) or GeoJSON → SVG conversion | Clean, dark-mode compatible, tiny footprint (< 100 KB) |
| **Deployment** | **Docker → nginx:alpine** serving `dist/` | ~5 MB image; works on any VPS |
| **Testing** | **Vitest** (unit) + **Playwright** (browser smoke) | Ships with Vite; same config |

### Project Structure

```
meridiana/
├── public/
│   ├── map.svg              # Mercator world map
│   └── favicon.svg
├── src/
│   ├── main.js              # Entry: boots the game, attaches listeners
│   ├── state.js             # Game state machine (daily / practice)
│   ├── locations.js         # Loads & selects from locations.json
│   ├── geo.js               # Mercator math, Haversine, feedback
│   ├── map-renderer.js      # Panzoom setup, pin placement, coordinate transforms
│   ├── ui.js                # DOM rendering (guess cards, modals, animations)
│   └── daily.js             # Daily-challenge seeding, streaks, sharing
├── data/
│   └── locations.json       # 20 curated locations (user-provided)
├── index.html
├── style.css
├── vite.config.js
├── Dockerfile
├── docker-compose.yml
├── nginx.conf
├── package.json
└── tests/
    ├── geo.test.js
    ├── state.test.js
    └── e2e/
        └── game.spec.js
```

---

## 2. State Management

Two modes share a single lightweight state object — no library needed.

```js
const gameState = {
  mode: 'daily' | 'practice',

  // Current round
  target: null,             // Location object from locations.json
  guesses: [],              // [{ lat, lng, distanceKm, timestamp }]
  maxGuesses: 5,
  isComplete: false,
  won: false,

  // Pin state (for "place then confirm" mechanic)
  pendingPin: null,         // { lat, lng } — placed but not yet submitted

  // Daily-specific
  daily: {
    dateKey: '2026-03-03',
    seed: null,
    streak: 0,
    completedToday: false,
  },

  // Practice-specific
  practice: {
    history: [],            // recent location IDs to avoid repeats
  },
};
```

### Daily Challenge flow

1. Compute `dateKey` from UTC date → hash into deterministic index.
2. Check `localStorage['meridiana_daily']` → restore state if already played today.
3. On completion → persist result + update streak.

### Practice Mode flow

1. Pick random location (exclude recent history).
2. No streak tracking; unlimited replays.
3. After each round → "Play Again" or "Switch to Daily."

> [!NOTE]
> All persistence uses `localStorage`. No backend required for MVP.

---

## 3. Data Structure — [locations.json](file:///c:/Users/VORPC/Downloads/VPS/antigravity/meridiana/20locations.json)

Using the user-provided [20locations.json](file:///c:/Users/VORPC/Downloads/VPS/antigravity/meridiana/20locations.json) with 20 globally recognisable landmarks.

### Schema

```json
{
  "id":         "string  — unique slug",
  "name":       "string  — display name",
  "country":    "string  — ISO 3166-1 alpha-2",
  "lat":        "number  — [-90, 90]",
  "lng":        "number  — [-180, 180]",
  "difficulty": "string  — easy | medium | hard",
  "funFact":    "string  — shown after round ends",
  "tags":       "string[] — e.g. ['landmark', 'europe']"
}
```

> [!TIP]
> Start with these 20 world-famous icons so the Daily Challenge is fair for players globally. Expand to 50+ later with themed packs.

---

## 4. Coordinate Logic

### 4.1 Mercator Projection — Pixel ↔ Lat/Lng

Unlike equirectangular, Mercator warps latitude non-linearly. The inverse Gudermannian converts pixel Y back to latitude.

**Lat → Pixel Y (for placing the target/pin):**

```
y = H/2 − (W / 2π) · ln(tan(π/4 + φ/2))
```

**Pixel Y → Lat (for reading a click):**

```js
export function pixelToLatLng(x, y, mapWidth, mapHeight) {
  const lng = (x / mapWidth) * 360 - 180;

  // Inverse Mercator (Gudermannian)
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / mapHeight)));
  const lat = (latRad * 180) / Math.PI;

  return { lat, lng };
}
```

**Lat/Lng → Pixel (for pin placement):**

```js
export function latLngToPixel(lat, lng, mapWidth, mapHeight) {
  const x = ((lng + 180) / 360) * mapWidth;

  const latRad = (lat * Math.PI) / 180;
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const y = mapHeight / 2 - (mapWidth * mercN) / (2 * Math.PI);

  return { x, y };
}
```

> [!IMPORTANT]
> When using **panzoom**, the `pixelToLatLng` function must account for the current **CSS scale and translate** values. Use `getTransform()` from panzoom to un-project the click coordinates back to SVG space before computing lat/lng.

### 4.2 Haversine Formula

```js
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
```

### 4.3 Directional Feedback

```js
export function feedback(guessLat, guessLng, targetLat, targetLng) {
  const dLat = targetLat - guessLat;
  const dLng = targetLng - guessLng;
  const distKm = haversineKm(guessLat, guessLng, targetLat, targetLng);

  const ns = Math.abs(dLat) < 1 ? '' :
    dLat > 0 ? `${Math.abs(dLat).toFixed(0)}° too far South` :
               `${Math.abs(dLat).toFixed(0)}° too far North`;

  const ew = Math.abs(dLng) < 1 ? '' :
    dLng > 0 ? `${Math.abs(dLng).toFixed(0)}° too far West` :
               `${Math.abs(dLng).toFixed(0)}° too far East`;

  return { distKm, ns, ew };
}
```

> [!NOTE]
> **Antimeridian caveat (post-MVP):** If target is Hawaii and guess is Japan, the shortest E/W path crosses the 180° line. For MVP, simple `dLng` works for 99% of cases. If users report "East sending them the wrong way," add a `if (Math.abs(dLng) > 180)` wraparound correction.

---

## 5. Guess Mechanic — "Place, Adjust, Confirm"

Instead of a single tap committing a guess:

1. **Tap/click** → a draggable pin appears at the click position.
2. **Zoom/pan** → the player can navigate the map to fine-tune placement.
3. **Pin stays constant size** on screen (inverse-scale with zoom level).
4. **Pin colour updates in real-time** as a "hot/cold" indicator (optional — see §6).
5. **"Submit Guess" button** → commits the pin's current position as the official guess.

This gives mobile players accuracy comparable to desktop.

---

## 6. Tiered Scoring & Visual Feedback

### Distance Tiers

| Tier | Distance | Colour | Emoji | Effect |
|---|---|---|---|---|
| 🎯 Bullseye | < 50 km | Gold | ⭐ | Confetti animation |
| 🟢 Win | < 200 km | `--success` green | 🟩 | Round won |
| 🟡 Close | 200 – 1 000 km | Yellow | 🟨 | — |
| 🟠 Warm | 1 000 – 3 000 km | `--warning` orange | 🟧 | — |
| 🔴 Far | > 3 000 km | `--accent` red | 🟥 | — |

### Hot/Cold Pin Colour

While the pin is placed (but not yet submitted), its colour reflects approximate distance to the target using the same colour gradient above. This gives the player instant visual feedback as they drag/reposition.

---

## 7. Modular Task Breakdown (6 Tasks)

Each task is self-contained and promptable individually.

---

### Task 1 — Project Scaffold, Map & Panzoom

**Goal:** Bootable Vite project with Docker, Mercator SVG map, and zoom/pan.

| Item | Detail |
|---|---|
| Init Vite | `npm create vite@latest ./ -- --template vanilla` |
| `Dockerfile` | Multi-stage: Node build → nginx:alpine serve |
| `docker-compose.yml` | Single service, port 8080 |
| `nginx.conf` | SPA fallback + static asset caching |
| Base `index.html` + `style.css` | Dark theme, Inter font, CSS custom properties |
| Map SVG | Download/embed [simplemaps world.svg](https://simplemaps.com/static/svg/world.svg) |
| `map-renderer.js` | Integrate `panzoom` library for zoom/pan |
| Pin rendering | Constant screen-size pin (inverse-scale with zoom) |
| `pixelToLatLng()` | Mercator inverse, accounting for panzoom transform |
| `latLngToPixel()` | Mercator forward, for pin/target placement |
| Verify | `docker compose up --build` → map loads, draggable, pin drops on click |

---

### Task 2 — Coordinate Engine & Distance Logic (`geo.js`)

**Goal:** Haversine distance, directional feedback, and unit tests.

| Item | Detail |
|---|---|
| `haversineKm()` | Great-circle distance between two coordinates |
| `feedback()` | Directional text: "X° too far North/South/East/West" |
| Distance tier classifier | Returns tier object (colour, emoji, label) for a given km |
| Unit tests | `geo.test.js` — known distances (e.g. NYC↔London ≈ 5,570 km), edge cases |

---

### Task 3 — Location Data & Selection Logic (`locations.js`)

**Goal:** Load the 20 locations, deterministic daily pick, random practice pick.

| Item | Detail |
|---|---|
| Move [20locations.json](file:///c:/Users/VORPC/Downloads/VPS/antigravity/meridiana/20locations.json) → `data/locations.json` | Rename/restructure for production |
| `loadLocations()` | Fetch + cache at startup |
| `pickDaily(dateKey)` | Date-hash → deterministic index |
| `pickRandom(excludeIds)` | Practice mode; avoids recent repeats |
| Unit tests | Determinism of daily pick, no duplicates in practice |

---

### Task 4 — Game State Machine (`state.js`)

**Goal:** Round lifecycle, guess tracking, win/loss with tiered thresholds.

| Item | Detail |
|---|---|
| `createGameState(mode)` | Factory returning the state shape |
| `placePendingPin(state, lat, lng)` | Sets `pendingPin` (not yet committed) |
| `submitGuess(state)` | Commits `pendingPin` → computes distance → checks tiers |
| Win condition | Distance < 200 km → `won = true` |
| `isRoundOver(state)` | `won === true` OR `guesses.length >= 5` |
| Daily completion guard | Prevent replaying today's challenge |
| Unit tests | Win at 199 km, loss at 201 km, max-guess enforcement |

---

### Task 5 — UI Rendering & Animations (`ui.js` + `style.css`)

**Goal:** Wordle-inspired minimalist UI with micro-animations.

| Item | Detail |
|---|---|
| **Header** | Logo + streak 🔥 + mode pill toggle (Daily · Practice) |
| **Map area** | SVG + panzoom container + pin + "Submit Guess" button |
| **Target prompt** | "Find: Eiffel Tower 🇫🇷" |
| **Guess cards** | Stack of ≤ 5 cards: distance, direction arrows, colour-coded tier |
| **Hot/cold pin** | Pin colour shifts in real-time based on proximity |
| **Result modal** | Slide-up: distance, fun fact, share button, "Play Again" |
| **Confetti** | On bullseye (< 50 km) |
| **Responsive** | Mobile-first; map fills viewport; cards stack below |
| **Dark mode** | Default dark (`--bg: #0f0f1a`, `--surface: #1a1a2e`) |

### Layout

```
┌──────────────────────────────────────────────┐
│  🌐 MERIDIANA          🔥 3    Daily|Practice │
├──────────────────────────────────────────────┤
│                                              │
│           [ World Map — Zoomable ]           │
│              📍 (draggable pin)              │
│                                              │
│            [ 🎯 Submit Guess ]               │
├──────────────────────────────────────────────┤
│  Find: Eiffel Tower 🇫🇷                     │
├──────────────────────────────────────────────┤
│  Guess 1:  2,431 km  ↗ 15° N · 22° E   🟥  │
│  Guess 2:    843 km  ↗  5° N ·  8° E   🟧  │
│  Guess 3:    127 km  ↗  1° S ·  1° W   🟩  │
├──────────────────────────────────────────────┤
│           [ Guess 3 of 5 ]                   │
└──────────────────────────────────────────────┘
```

---

### Task 6 — Daily Challenge, Streaks & Sharing (`daily.js`)

**Goal:** Persist daily progress, streaks, emoji share grid.

| Item | Detail |
|---|---|
| `localStorage` schema | `{ dateKey, guesses, won, streak, maxStreak }` |
| Streak logic | Increment on consecutive-day wins; reset on miss |
| Share text | Emoji grid per guess: 🟥🟧🟨🟩⭐ mapped to tier |
| Copy-to-clipboard | `navigator.clipboard.writeText()` with fallback |
| "Already played" gate | Show result modal if today is complete |
| Stats modal | Total played, win %, streak, max streak, distribution chart |

---

## 8. Docker Deployment

### Dockerfile

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.25-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### nginx.conf

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
    location ~* \.(?:js|css|svg|png|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

### docker-compose.yml

```yaml
version: "3.9"
services:
  meridiana:
    build: .
    ports:
      - "8080:80"
    restart: unless-stopped
```

---

## 9. Verification Plan

### Automated Tests (Vitest)

| Test file | Covers |
|---|---|
| `geo.test.js` | Mercator `pixelToLatLng`/`latLngToPixel`, `haversineKm`, `feedback` |
| `state.test.js` | State transitions, tiered win/loss, max-guess enforcement |
| `locations.test.js` | Daily pick determinism, no practice repeats |

### Browser Smoke Tests (Playwright)

| Test | Assertion |
|---|---|
| Page loads | Title contains "Meridiana" |
| Map zoom/pan works | Panzoom transform changes on pinch/scroll |
| Pin placement | Click → pin appears; pin stays constant size on zoom |
| Submit guess flow | Click → place pin → "Submit Guess" → guess card appears |
| Daily replay block | After completing, refresh → shows result modal |

### Manual Verification

1. `docker compose up --build` → `http://localhost:8080`
2. Click map → pin appears → drag to adjust → Submit Guess → card slides in
3. On bullseye (< 50 km) → confetti plays
4. After 5 guesses or win → result modal with fun fact + Share button
5. Share → paste → verify emoji grid
6. Refresh → daily shows "Already played"
7. Switch to Practice → new location, unlimited replays

---

## Summary

| # | Task | Key Deliverables | Est. Effort |
|---|---|---|---|
| 1 | Scaffold, Map & Panzoom | Vite, Docker, Mercator SVG, panzoom, pin, coord transforms | ~2.5 hrs |
| 2 | Coordinate Engine | Haversine, directional feedback, distance tiers, tests | ~1.5 hrs |
| 3 | Location Data | [locations.json](file:///c:/Users/VORPC/Downloads/VPS/antigravity/meridiana/20locations.json), daily/random selection, tests | ~1 hr |
| 4 | Game State Machine | Round lifecycle, place-confirm-submit, tiered win, tests | ~1.5 hrs |
| 5 | UI/UX | Full interface, hot/cold pin, animations, responsive, dark mode | ~3 hrs |
| 6 | Daily Challenge & Sharing | Streaks, localStorage, emoji grid, stats modal | ~2 hrs |

**Total estimated MVP:** ~11.5 hours across 6 discrete, promptable tasks.
