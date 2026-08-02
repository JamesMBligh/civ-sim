# Design: Economic Geography — Roads, Trade Routes & Living Settlements

The problem: settlements currently appear in a near-grid pattern (an
artifact of the daughter-site search: a random ring at 8–16 tiles with a
minimum separation), they never shrink for economic reasons, and nothing
connects them. Real settlements exist *because of geography and
exchange* — at fords and confluences, in sheltered harbors, beside
mines, and at the crossroads of routes that themselves shift as
technology changes and resources run out.

The unifying idea: **give the world a movement-cost surface, derive
trade routes over it, and let settlements live and die by their place
in the network.** Everything the brief asks for falls out of that one
structure.

## 1. The movement-cost surface (the substrate)

A per-tile cost to move goods, from which everything else derives:

| Terrain | Base cost |
| --- | --- |
| Grassland / plains | 1.0 |
| Forest | 1.8 |
| Hills | 2.5 |
| Mountains | 6.0 |
| Marsh | 3.0 |
| River (along, with Boats) | 0.3 |
| River (crossing, no ford/bridge) | +2.0 penalty |
| Coastal sea (with Boats) | 0.4 |
| Open sea (with Sailing) | 0.5 |
| Peaks / deep ocean | impassable |

**Technology reshapes the surface** — this is the heart of the "river
until roads" dynamic:

- *Boats*: rivers and coasts become the cheapest paths on the map.
  Early trade hugs the water, exactly as it did historically.
- *Bridges* (new tech): removes the river-crossing penalty at built
  crossings.
- *Roads* (new tech): allows road tiles (see §3) at cost 0.5 — suddenly
  straight-line overland routes can outcompete meandering rivers, and
  the map's logic visibly reorganises.

Pathfinding is A* over this grid. With ~30–60 settlements and routes
recomputed lazily (only when tech, roads, ownership or the settlement
set change), cost is negligible at our scale.

## 2. Site value: why a settlement is *here*

Replace the current food-only settlement score with:

```
siteValue = foodValue                      (as today)
          + harborValue                    (sheltered coast: coast tile with 3+ sea
                                            neighbours and adjacent deep-water access)
          + fordValue                      (river crossing where a river is 1 tile wide
                                            and land flanks both sides)
          + confluenceValue                (two+ river branches meeting, or river mouth)
          + mineValue                      (active mineral deposits within 2 tiles)
          + passValue                      (low-cost corridor tile between two
                                            high-cost regions)
          + routeValue                     (existing trade-route flow through the tile —
                                            crossroads attract settlement; see §4)
```

Harbor, ford, confluence and pass values are **static geography** —
computed once at worldgen and cached (they're properties of the map,
not the moment). Mine and route values are dynamic.

Daughter settlements then stop scattering in rings: the search picks
the best `siteValue` within reach, which means ports, ford-towns,
mining camps and crossroads markets emerge *by name and by cause*. The
chronicle can say why: "The Fenfolk founded Ashmouth where the river
meets the sea."

## 3. Trade routes and roads

**Routes.** Every trade relationship (and every same-tribe settlement
pair — internal trade matters first) computes its cheapest path. A
route is *active* if path cost is below a threshold scaled by both
ends' economies; its **flow** is a function of the two settlements'
production and complementarity (metal for grain, salt for timber…).

**Tracks emerge from use; roads are built on purpose.** Two-stage,
matching history:

1. Route tiles accumulate *wear* proportional to flow. Enough wear →
   a **track** (cost ×0.8, drawn as a faint line). Tracks fade if
   traffic stops — desire lines, not infrastructure.
2. With the *Roads* tech, a tribe invests surplus in upgrading its
   highest-flow tracks to **roads** (cost 0.5, permanent, drawn
   solid). Road-building rate scales with discipline and governance —
   Rome builds roads; a fractious chiefdom keeps its mud tracks.

Because roads change the cost surface, they reroute trade, which
shifts wear, which moves where the *next* road pays — the network
grows organically and history-shaped, not planned.

**Rendering.** Tracks and roads drawn on the satellite view (they are
physically visible — fits the new satellite philosophy); a new
**Trade** overlay/view showing active routes as flow-weighted lines,
ports and crossroads highlighted.

## 4. Settlements that live and die by the economy

Each settlement gets a small economy:

```
economy = localProduction          (food worked + resource extraction)
        + tradeIncome              (flow of routes terminating here)
        + marketIncome             (flow of routes passing through — the
                                    crossroads bonus)
```

- Growth: the logistic food cap remains the hard ceiling, but the
  growth *rate* is multiplied by economic health. A booming port
  grows fast toward its cap; a town whose mine died or whose route
  moved **shrinks** — and the existing abandonment rule gives us
  ghost towns for free.
- The crossroads feedback loop: routes create market income → the
  waypoint grows → `routeValue` rises → more routes prefer it → a
  market town. This is how real crossroads towns bootstrap.
- Trade income also replaces the current flat `tradePartners` bonus
  in knowledge-pool gains, so prosperity genuinely flows from the
  network rather than from a boolean.

## 5. Resource exhaustion and extraction technology

Mineral resources become finite, tiered deposits:

```
deposit = { surface: N, deep: M }    // units of extraction remaining
```

- A settlement within reach of a deposit (and with the era's
  extraction tech) works it: extraction feeds the settlement's
  economy and decrements the deposit.
- **Surface exhausted** → the tile goes *dormant* — shown greyed on
  the mineral view, the mine town's economy sags, chronicle notes it:
  "The gold at Kelford is worked out; the town dwindles."
- **Deep Mining** (new Iron Age-adjacent tech) reopens dormant
  deposits (the `deep` tier) — the ghost town can boom again, which
  is exactly the gold-mine story in the brief.
- Renewables (fish, game, timber, fertile soil) stay non-depleting
  for now — overfishing/deforestation is a good later chapter, and
  mixing it in here would muddy the mineral story.
- Sizing: `surface` sized so a worked mine lasts ~80–200 years;
  `deep` 2–3× that. Tin provinces staying scarce-but-durable keeps
  the Bronze Age trade dynamic alive.

New techs to support all this (all resource/prereq-gated as usual):
*Bridges*, *Roads* (require Masonry / discipline-friendly), *Sailing*
(after Boats; opens open-sea lanes), *Deep Mining* (after Iron
Working).

## 6. What this changes elsewhere (the good kind of ripple)

- **War**: rich route towns and mines become the *targets* — raid and
  conquest preferences weight by economy, not just proximity. Cutting
  a rival's route (taking the ford town) becomes strategy for free.
- **Tribute** scales with the loser's economy instead of a flat drag.
- **Civil war**: splinters that take the periphery now take *real*
  assets (mines, ports) — or lose them, making reconquest matter.
- **Unity**: an empire held together by roads (high road connectivity
  between its settlements) could resist disunity better — Rome again.
  (Optional, phase 4+.)

## 7. Implementation phases

1. **Sites & surface.** Movement-cost grid; static geography values
   (harbor/ford/confluence/pass) at worldgen; new `siteValue` in
   settlement placement. *Visible result: the grid pattern dies —
   settlements land at fords, harbors, mines.*
2. **Routes & living economies.** A* routes (internal + trade
   partners), flow, settlement economy, growth/shrink modulation,
   Trade view. *Visible result: towns grow where routes cross, fade
   when routes move.*
3. **Tracks & roads.** Wear accumulation, track emergence, Roads +
   Bridges techs, deliberate road-building, cost-surface feedback.
   *Visible result: the river-age gives way to the road-age on the
   map.*
4. **Exhaustion & deep mining.** Finite deposits, dormancy, Deep
   Mining, mine-town boom/bust cycles. *Visible result: ghost towns,
   and their second lives.*

Each phase is independently shippable and testable headlessly
(settlement-site distributions, route counts, road km over time,
deposit lifecycles) with the usual determinism guarantees.

## 8. Resolved decisions

1. **Roads**: hybrid confirmed — tracks emerge from use, roads are
   deliberately built (discipline/governance lever).
2. **Renewables**: do not deplete in this phase; minerals only.
3. **Internal trade**: yes — same-tribe routes are first-class.
4. **Views**: dedicated Trade view for route flows, plus a roads
   toggle on the satellite view (Google Maps style, default on).
5. **Sea lanes**: coastal shipping ships now (via Boats);
   open-sea Sailing and inter-island trade/invasion deferred to a
   later maritime chapter.
