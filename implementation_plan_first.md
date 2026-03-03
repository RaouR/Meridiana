# Meridiana — Technical Requirement Document & Implementation Plan

> A geography-themed browser game where the player guesses the location of a city or landmark by clicking on a world map.

---

## 1. Tech Stack Recommendation

| Layer | Choice | Rationale |
|---|---|---|
| **Build tool** | **Vite 6** | Near-instant HMR, zero-config for vanilla JS, tiny production bundles |
| **Language** | **Vanilla JS (ES Modules)** | No framework overhead; the game logic is self-contained. Easy to maintain, zero runtime deps |
| **Styling** | **Vanilla CSS** with CSS custom properties | Full control, dark-mode toggle via `prefers-color-scheme`, no build-time CSS tooling |
| **Map rendering** | **Static SVG world map** (Equirectangular / plate-carrée projection) | Pixel ↔ Lat/Long math is trivial; no tile-server or API key required |
| **Deployment** | **Docker → nginx:alpine** serving the `dist/` folder | ~5 MB image; works on any VPS, Railway, Fly.io, etc. |
| **Testing** | **Vitest** (unit) + **Playwright** (browser smoke) | Ships with Vite; fast; same config |

> [!TIP]
> By choosing an **Equirectangular SVG** (a projection where longitude maps linearly to X and latitude maps linearly to Y), coordinate conversion becomes a simple linear formula — no complex map-tile math or third-party map library needed.

### Project Structure (planned)

```
meridiana/
├── public/
│   ├── map.svg          # Equirectangular world map
│   └── favicon.svg
├── src/
│   ├── main.js          # Entry: boots the game, attaches listeners
│   ├── state.js         # Game state machine (daily / practice)
│   ├── locations.js     # Loads & selects from locations.json
│   ├── geo.js           # Haversine, pixel↔latlng, feedback text
│   ├── ui.js            # DOM rendering helpers (result cards, modals)
│   └── daily.js         # Daily-challenge seeding & streak storage
├── data/
│   └── locations.json   # Curated location dataset
├── index.html
├── style.css
├── vite.config.js
├── Dockerfile
├── docker-compose.yml
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
// state.js — conceptual shape
const gameState = {
  mode: 'daily' | 'practice',

  // Current round
  target: null,          // Location object (see §3)
  guesses: [],           // Array of { lat, lng, distanceKm, timestamp }
  maxGuesses: 5,
  isComplete: false,
  won: false,

  // Daily-specific
  daily: {
    dateKey: '2026-03-03', // derived from UTC date
    seed: null,            // deterministic index into locations[]
    streak: 0,
    completedToday: false,
  },

  // Practice-specific
  practice: {
    history: [],           // recent location IDs
  },
};
```

### Daily Challenge flow

1. On page load → compute `dateKey = new Date().toISOString().slice(0, 10)`.
2. Seed a simple hash of the date string → deterministic index into the locations array.
3. Check `localStorage['meridiana_daily']` — if `dateKey` matches, restore state (prevent replay).
4. On completion → persist result + update streak counter.

### Practice Mode flow

1. Player clicks **"Practice"** → pick a random location (exclude recent history to avoid repeats).
2. No streak tracking; unlimited replays.
3. After each round → option to "Play Again" or "Switch to Daily."

> [!NOTE]
> All persistence uses `localStorage`. No backend or database is required for MVP.

---

## 3. Data Structure — `locations.json`

### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "MeridianaLocation",
  "type": "array",
  "items": {
    "type": "object",
    "required": ["id", "name", "country", "lat", "lng", "difficulty"],
    "properties": {
      "id":         { "type": "string", "description": "Unique slug, e.g. 'paris-eiffel-tower'" },
      "name":       { "type": "string", "description": "Display name, e.g. 'Eiffel Tower'" },
      "country":    { "type": "string", "description": "ISO 3166-1 alpha-2, e.g. 'FR'" },
      "lat":        { "type": "number", "minimum": -90, "maximum": 90 },
      "lng":        { "type": "number", "minimum": -180, "maximum": 180 },
      "difficulty": { "type": "string", "enum": ["easy", "medium", "hard"] },
      "funFact":    { "type": "string", "description": "Shown after the round ends" },
      "hint":       { "type": "string", "description": "Optional clue revealed after N wrong guesses" },
      "tags":       { "type": "array", "items": { "type": "string" }, "description": "e.g. ['capital', 'landmark', 'europe']" }
    }
  }
}
```

### Example entry

```json
{
  "id": "paris-eiffel-tower",
  "name": "Eiffel Tower",
  "country": "FR",
  "lat": 48.8584,
  "lng": 2.2945,
  "difficulty": "easy",
  "funFact": "The Eiffel Tower was supposed to be dismantled after 20 years but was saved because it was useful as a radio antenna.",
  "hint": "City of Light",
  "tags": ["landmark", "europe", "france"]
}
```

> [!IMPORTANT]
> **Data drudgery mitigation:** Start with ~50 hand-curated entries covering recognisable world capitals and landmarks. The schema's `tags` and `difficulty` fields let us filter subsets for themed rounds later. Additional entries can be crowd-sourced or generated from public datasets (GeoNames, Natural Earth) with a small script.

---

## 4. Coordinate Logic

### 4.1 Pixel → Lat/Lng (Equirectangular projection)

On an equirectangular map image of known pixel dimensions (`W × H`), the projection is **linear**:

```
lng = (x / W) × 360 − 180
lat = 90 − (y / H) × 180
```

In code:

```js
// geo.js
export function pixelToLatLng(x, y, mapWidth, mapHeight) {
  const lng = (x / mapWidth) * 360 - 180;
  const lat = 90 - (y / mapHeight) * 180;
  return { lat, lng };
}
```

Implementation notes:
- Obtain `mapWidth` / `mapHeight` from the **SVG viewBox** (or the rendered `<img>` size).
- Use the click event's `offsetX` / `offsetY` relative to the map container.
- Account for CSS scaling by comparing the element's `clientWidth` to the intrinsic width.

### 4.2 Haversine Formula — Great-circle distance

The Haversine formula computes the shortest distance between two points on a sphere given their latitudes and longitudes:

```
a = sin²(Δφ/2) + cos(φ₁) · cos(φ₂) · sin²(Δλ/2)
c = 2 · atan2(√a, √(1−a))
d = R · c
```

Where `φ` = latitude in radians, `λ` = longitude in radians, `R` = 6371 km (Earth's mean radius).

```js
// geo.js
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
```

### 4.3 Directional Feedback

After computing the raw lat/lng difference:

```js
export function feedback(guessLat, guessLng, targetLat, targetLng) {
  const dLat = targetLat - guessLat;
  const dLng = targetLng - guessLng;
  const distKm = haversineKm(guessLat, guessLng, targetLat, targetLng);

  const ns = Math.abs(dLat) < 1 ? '' : dLat > 0 ? `${Math.abs(dLat).toFixed(0)}° too far South` : `${Math.abs(dLat).toFixed(0)}° too far North`;
  const ew = Math.abs(dLng) < 1 ? '' : dLng > 0 ? `${Math.abs(dLng).toFixed(0)}° too far West`  : `${Math.abs(dLng).toFixed(0)}° too far East`;

  return { distKm, ns, ew };
}
```

---

## 5. Modular Task Breakdown (6 Tasks)

Each task is self-contained and can be prompted individually.

---

### Task 1 — Project Scaffold & Docker Setup

**Goal:** Bootable Vite project with Docker deployment ready from day one.

| Item | Detail |
|---|---|
| Init Vite project | `npm create vite@latest ./ -- --template vanilla` |
| Add `Dockerfile` | Multi-stage: Node build → nginx:alpine serve |
| Add `docker-compose.yml` | Single service, port 8080 |
| Add placeholder `index.html` | Dark background + "Meridiana" title |
| Add `style.css` | CSS reset, custom properties for colours, typography (Google Font: *Inter*) |
| Verify | `docker compose up --build` → page loads at `localhost:8080` |

---

### Task 2 — Map Rendering & Coordinate Engine (`geo.js`)

**Goal:** Render an equirectangular SVG map; convert clicks to lat/lng; implement Haversine.

| Item | Detail |
|---|---|
| Source/create equirectangular SVG | Use a public-domain Natural Earth SVG or generate one |
| Render map in `index.html` | `<img>` or inline `<svg>`, responsive via CSS `max-width: 100%` |
| `pixelToLatLng()` | As described in §4.1 |
| `haversineKm()` | As described in §4.2 |
| `feedback()` | Directional hints as described in §4.3 |
| Click handler | Attach to map container; call `pixelToLatLng`; place a pin marker |
| Unit tests | `geo.test.js` — known city coordinates, edge cases (antimeridian, poles) |

---

### Task 3 — Location Data & Selection Logic (`locations.js`)

**Goal:** Load, validate, and select locations for each round.

| Item | Detail |
|---|---|
| Create `data/locations.json` | ~50 curated entries following the schema in §3 |
| `loadLocations()` | Fetch + cache the JSON at startup |
| `pickDaily(dateKey)` | Deterministic selection via date-hash |
| `pickRandom(excludeIds)` | For practice mode; avoids recent repeats |
| `getDifficultyPool(level)` | Filter by difficulty tag |
| Unit tests | `locations.test.js` — determinism of daily pick, no duplicates |

---

### Task 4 — Game State Machine (`state.js`)

**Goal:** Manage round lifecycle, guess tracking, and win/loss conditions.

| Item | Detail |
|---|---|
| `createGameState(mode)` | Factory returning the state shape from §2 |
| `submitGuess(state, lat, lng)` | Pushes guess, computes distance, checks win (< 150 km) |
| `isRoundOver(state)` | `won === true` OR `guesses.length >= maxGuesses` |
| `resetRound(state)` | Clears guesses, picks new target |
| Daily completion guard | Prevent replaying today's challenge |
| Unit tests | `state.test.js` — win detection, max-guess enforcement |

---

### Task 5 — UI Rendering & Animations (`ui.js` + `style.css`)

**Goal:** Wordle-inspired minimalist UI with smooth micro-animations.

| Item | Detail |
|---|---|
| **Header** | Logo/title + streak counter (🔥) + mode toggle |
| **Map area** | Map + click-to-guess pin + pulsing target reveal on round end |
| **Guess cards** | Stack of up to 5 cards showing: distance, direction arrows (↑↓←→), colour gradient (red → green) |
| **Result modal** | Slide-up modal with: distance, fun fact, share button (copy emoji grid à la Wordle) |
| **Mode selector** | Pill toggle: Daily · Practice |
| **Animations** | Card flip on new guess, pin drop bounce, confetti on perfect guess (< 50 km) |
| **Responsive** | Mobile-first; map scales; cards stack vertically on narrow screens |
| **Dark mode** | Default dark; respect `prefers-color-scheme` |

Visual palette guidelines:

```
--bg:          #0f0f1a  (deep navy)
--surface:     #1a1a2e  (card bg)
--accent:      #e94560  (primary CTA / close guess)
--success:     #0ead69  (win / very close)
--warning:     #f4a261  (medium distance)
--text:        #eaeaea
--text-muted:  #888
--font:        'Inter', system-ui, sans-serif
```

---

### Task 6 — Daily Challenge, Streaks & Sharing (`daily.js`)

**Goal:** Persist daily progress, track streaks, enable social sharing.

| Item | Detail |
|---|---|
| `localStorage` schema | `{ dateKey, guesses, won, streak, maxStreak }` |
| Streak logic | Increment on consecutive-day wins; reset on miss |
| Share text generator | Emoji grid like Wordle: 🟥🟧🟨🟩 per guess distance band |
| Copy-to-clipboard | `navigator.clipboard.writeText()` with fallback |
| "Already played" gate | Show result modal immediately if today is complete |
| Stats modal | Total played, win %, current streak, max streak, guess distribution bar chart |

---

## 6. UI/UX — Wordle-Style Minimalist Design

### Design Principles

1. **One action per screen** — the player's only job is to click the map.
2. **Progressive disclosure** — distance feedback appears one card at a time (animated).
3. **Colour as data** — guess cards shift from 🔴 (far) → 🟡 (warm) → 🟢 (close) based on km distance.
4. **Shareability** — the emoji result grid is the viral loop (same as Wordle).
5. **No clutter** — no ads, no login, no sign-up. Just the game.

### Responsive Layout

```
┌──────────────────────────────────────────────┐
│  🌐 MERIDIANA          🔥 3    Daily|Practice │  ← Header
├──────────────────────────────────────────────┤
│                                              │
│           [ World Map SVG ]                  │  ← Click area
│              📍 (guess pin)                  │
│                                              │
├──────────────────────────────────────────────┤
│  Find: Eiffel Tower 🇫🇷                     │  ← Target prompt
├──────────────────────────────────────────────┤
│  Guess 1:  2,431 km  ↗ 15° N · 22° E   🟥  │  ← Guess cards
│  Guess 2:    843 km  ↗  5° N ·  8° E   🟧  │
│  Guess 3:    127 km  ↗  1° S ·  1° W   🟩  │
├──────────────────────────────────────────────┤
│           [ Guess 3 of 5 ]                   │  ← Progress
└──────────────────────────────────────────────┘
```

### Colour Distance Bands

| Band | Distance | Colour | Emoji |
|---|---|---|---|
| 🔴 Far | > 3 000 km | `--accent` red | 🟥 |
| 🟠 Warm | 1 000 – 3 000 km | `--warning` orange | 🟧 |
| 🟡 Getting close | 300 – 1 000 km | yellow | 🟨 |
| 🟢 Very close | < 300 km | `--success` green | 🟩 |
| 🎯 Bullseye | < 50 km | gold + confetti | ⭐ |

---

## 7. Docker Deployment

### Dockerfile

```dockerfile
# Stage 1 — Build
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2 — Serve
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
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets aggressively
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

> Deploy: `docker compose up -d --build`

---

## 8. Verification Plan

### Automated Tests (Vitest)

```bash
npx vitest run          # runs all unit tests
```

| Test file | Covers |
|---|---|
| `tests/geo.test.js` | `pixelToLatLng`, `haversineKm`, `feedback` — known coordinates, edge cases |
| `tests/state.test.js` | State transitions, win/loss detection, max-guess enforcement |
| `tests/locations.test.js` | Daily pick determinism, no duplicates, schema validation |

### Browser Smoke Test (Playwright)

```bash
npx playwright test     # headless Chromium
```

| Test | Assertion |
|---|---|
| Page loads | Title contains "Meridiana" |
| Map click registers | Pin marker appears on map |
| Guess card appears | After click, a guess card is rendered |
| Daily mode blocks replay | After completing, re-visiting shows result modal |

### Manual Verification (for user)

1. **`docker compose up --build`** → open `http://localhost:8080`.
2. Click on the map — a pin should appear and a guess card should slide in.
3. After 5 guesses or a bullseye, the result modal should appear with a fun fact.
4. Click **Share** → paste into a text editor → verify emoji grid is correct.
5. Refresh the page → daily challenge should show "Already played" state.
6. Switch to **Practice** → new location should load; unlimited replays.

---

## Summary

| # | Task | Key Deliverables | Estimated Effort |
|---|---|---|---|
| 1 | Scaffold & Docker | Vite project, Dockerfile, `docker-compose.yml`, base CSS | ~1 hour |
| 2 | Map & Coordinate Engine | SVG map, `geo.js`, unit tests | ~2 hours |
| 3 | Location Data | `locations.json` (50 entries), selection logic, tests | ~2 hours |
| 4 | Game State Machine | `state.js`, round lifecycle, tests | ~1.5 hours |
| 5 | UI/UX | Full interface, animations, responsive layout, dark mode | ~3 hours |
| 6 | Daily Challenge & Sharing | Streaks, localStorage, share grid, stats modal | ~2 hours |

**Total estimated MVP:** ~11.5 hours of implementation across 6 discrete, promptable tasks.
