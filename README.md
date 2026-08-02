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
- **Temperature** that falls from south to north and with altitude
  (~6.5°C per 1000 m), so the highlands run cold.
- **Rivers** that spring in the highlands and flow downhill to the sea,
  merging with each other and forming small lakes in depressions.
- **Resources** placed where they'd plausibly occur: ores and stone in the
  mountains, timber and game in forests, fish along the coasts, fertile
  soil and clay in river valleys, salt on the shore.
- **Age-defining minerals**: the mineral set covers the strategic
  materials of early civilizations — flint and obsidian (Stone Age),
  copper, tin, gold, silver and lead (Bronze Age), and iron ore
  (Iron Age). The scarce metals (tin, gold, silver/lead) only occur in a
  couple of regional "ore provinces" per map, mirroring how deposits like
  Cornish tin concentrated in one district and drove long-distance trade.

Everything runs in memory in the browser — plain JavaScript, no build
step, no dependencies. Maps are reproducible: the same seed always
produces the same island.

## Running it

Open `index.html` in a browser, or serve the directory:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Built version & GitHub Pages

`node build.js` bundles the app into a single self-contained
`docs/index.html`. A GitHub Actions workflow
(`.github/workflows/build-docs.yml`) reruns the build on every push and
commits the result if it changed, so `/docs` always tracks the source.

To publish: repository **Settings → Pages → Build and deployment**, set
Source to *Deploy from a branch*, pick your branch and the `/docs`
folder.

## Controls

- **Seed** — type a seed and press Generate to recreate a specific island.
- **Random** — generate a fresh island with a new seed.
- **View** — switch between six map layers:
  - *Satellite* — terrain with hillshading and all resource markers
  - *Elevation* — raw heightmap (ocean depths to peaks)
  - *Avg rainfall* — annual rainfall from moisture (400–2800 mm)
  - *Avg temperature* — annual mean temperature (latitude + altitude)
  - *Natural resources* — fish, game, timber and fertile soil over a
    desaturated base map
  - *Mineral resources* — stone, flint, obsidian, copper, tin, iron,
    gold, silver, lead, clay and salt deposits
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
| `build.js` | Bundles everything into `docs/index.html` for GitHub Pages |

## Roadmap

1. ✅ Landscape generation (this stage)
2. Introduce primitive tribes at plausible starting locations
3. Simulate ten years of activity (foraging, settlement, growth)
4. Let the user intervene and observe the consequences
5. Deepen the model over time (agriculture, trade, conflict, culture…)
