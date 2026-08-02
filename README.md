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

## Current stage: how tribes evolve

Press **Found tribes & simulate 10 years** to introduce 7 tribes as
wandering bands of foragers, then press again to watch centuries
unfold. Full design in `design/tribe-evolution.md`.

- **Traits.** Every tribe has nine dispositions (cohesion, dogmatism,
  physicality, acumen, aggression, mercantile, artistry, contemplation,
  discipline) that guide everything it does. Six tribes draw from
  real-civilization archetypes — Hellenic, Roman, Israelite,
  Philistine, Persian, Han — with jitter; traits drift slowly with
  history (war hardens, trade opens) but stay within ±0.2 of their
  founding values. `discipline` is a variance dial: passionate peoples
  swing between golden ages and disasters, disciplined ones compound.
- **Nomads first.** Tribes begin as mobile bands — people, not places —
  with realistic forager demography (near-static populations).
  Mastering Agriculture ends the wandering: bands converge to found the
  tribe's first named settlement, and farming demography takes over
  (populations climb into the tens of thousands over centuries).
- **Knowledge.** Surplus feeds tech, art and philosophy pools; a
  ~20-node tech tree is heavily resource-gated (Bronze Working needs
  copper *and tin* within reach or via a trade partner), so the ore
  provinces shape who advances. Eras — Paleolithic through Iron Age —
  are per-tribe, and ideas also diffuse between peoples in contact.
- **Relations.** Contact becomes trade, rivalry or war depending on
  both sides' dispositions and resource envy. Trade shares resource
  access and speeds diffusion; war brings raids and, with a sustained
  edge, conquest — a settlement keeps its name and people but changes
  allegiance.
- **Society.** Governance ladders from band society through chiefdom
  to theocracy, kingship, council rule or merchant oligarchy, branching
  on traits; art and philosophy advance in stages that echo through
  the chronicle.

The **Development** view colours each territory by its tribe's era;
the tribes panel shows era badges and posture glyphs (⚔ military,
⚖ trade, 📜 learning), and clicking a tribe opens a full inspector —
trait bars, technologies, governance, relations. Simulation remains
deterministic per seed.

### Tribes vs settlements

Two deliberately separate concepts, mirroring the later distinction
between nation and city:

- A **tribe** is a *social* entity — a people with a shared identity.
  It has a name, a colour, and members, but no location of its own.
- A **settlement** is a *place* — a named camp at a location with
  inhabitants and a founding year (`world.settlements`).

A settlement declares **allegiance** to a tribe (`settlement.tribeId`);
a tribe never "contains" places. This keeps the door open for
settlements changing hands — conquest, secession, assimilation —
without either entity losing its identity, and scales cleanly from
camp/tribe to city/nation.

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
- **View** — switch between seven map layers:
  - *Satellite* — the island as it would actually look from above:
    terrain with hillshading, plus the visible marks of civilization —
    built-up ground at settlements and a tan patchwork of worked
    fields, growing as populations grow. Resource and settlement
    markers are off by default; toggle them from the legend.
  - *Communities* — the extent of each tribe's influence, with camps
    and tribe names
  - *Elevation* — raw heightmap (ocean depths to peaks)
  - *Avg rainfall* — annual rainfall from moisture (400–2800 mm)
  - *Avg temperature* — annual mean temperature (latitude + altitude)
  - *Natural resources* — fish, game, timber and fertile soil over a
    desaturated base map
  - *Mineral resources* — stone, flint, obsidian, copper, tin, iron,
    gold, silver, lead, clay and salt deposits
- **Hover** the map to inspect any tile (terrain, elevation, moisture,
  resource).
- **Zoom** from 1× to 5× with the mouse wheel (magnifies toward the
  cursor) or the −/+ buttons; **drag** the map to pan when zoomed in,
  and **Reset** returns to the whole island. At 2.5× and above,
  individual settlements are labelled with their own names.

## Code layout

| File | Purpose |
| --- | --- |
| `js/rng.js` | Seeded RNG (xmur3 + mulberry32) with forkable streams |
| `js/noise.js` | Seeded 2D value noise with fractal layering |
| `js/terrain.js` | Elevation & moisture fields, biome classification |
| `js/rivers.js` | Downhill river tracing with lake fill-and-spill |
| `js/resources.js` | Terrain-aware resource placement |
| `js/world.js` | World state container and generation pipeline |
| `js/render.js` | Canvas rendering, camera (zoom/pan) and map layers |
| `js/traits.js` | Nine traits, archetypes, posture triangle, drift |
| `js/tech.js` | Tech tree, eras, knowledge pools, discovery & diffusion |
| `js/tribes.js` | Tribes (social), bands (nomadic) & settlements (place) |
| `js/relations.js` | Contact, trade, rivalry, war, conquest |
| `js/sim.js` | Yearly simulation: demography, governance, influence |
| `js/main.js` | UI wiring |
| `build.js` | Bundles everything into `docs/index.html` for GitHub Pages |

## Roadmap

1. ✅ Landscape generation
2. ✅ Introduce primitive tribes at plausible starting locations
3. ✅ Simulate ten years of activity (foraging, settlement, growth)
4. ✅ Tribe evolution: traits, technology, relations, governance
5. Let the user intervene and observe the consequences
6. Deepen the model over time (cities, nations, writing history…)
