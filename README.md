# Civ Sim

A web-based civilization simulator that models the way real human
civilizations work. The project starts simple and will grow more complex
over time.

## Current stage: landscape generation

The simulator procedurally generates a large island — roughly the size of
Great Britain (~1000 km across, ~4 km per tile on a 256×256 grid) — with a
plausible Earth-like landscape:

- **Elevation** from seeded fractal noise with a radial falloff, so every
  map is a single island surrounded by ocean, with mountains, hills,
  plains and coasts.
- **Moisture** with a prevailing wind direction: the windward side of the
  island is wetter (forests, marshes), the leeward side drier (plains).
- **Rivers** that spring in the highlands and flow downhill to the sea,
  merging with each other and forming small lakes in depressions.
- **Resources** placed where they'd plausibly occur: ores and stone in the
  mountains, timber and game in forests, fish along the coasts, fertile
  soil and clay in river valleys, salt on the shore.

Everything runs in memory in the browser — plain JavaScript, no build
step, no dependencies. Maps are reproducible: the same seed always
produces the same island.

## Running it

Open `index.html` in a browser, or serve the directory:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Controls

- **Seed** — type a seed and press Generate to recreate a specific island.
- **Random** — generate a fresh island with a new seed.
- **View** — switch between terrain, raw elevation and moisture views.
- **Hover** the map to inspect any tile (terrain, elevation, moisture,
  resource).

## Code layout

| File | Purpose |
| --- | --- |
| `js/rng.js` | Seeded RNG (xmur3 + mulberry32) with forkable streams |
| `js/noise.js` | Seeded 2D value noise with fractal layering |
| `js/terrain.js` | Elevation & moisture fields, biome classification |
| `js/rivers.js` | Downhill river tracing with lake fill-and-spill |
| `js/resources.js` | Terrain-aware resource placement |
| `js/world.js` | World state container and generation pipeline |
| `js/render.js` | Canvas rendering (terrain / elevation / moisture) |
| `js/main.js` | UI wiring |

## Roadmap

1. ✅ Landscape generation (this stage)
2. Introduce primitive tribes at plausible starting locations
3. Simulate ten years of activity (foraging, settlement, growth)
4. Let the user intervene and observe the consequences
5. Deepen the model over time (agriculture, trade, conflict, culture…)
