# Design: How Tribes Evolve

The next phase of Civ Sim: tribes stop being interchangeable population
blobs and become *peoples* — with dispositions that shape how they act,
and progress that records what they have become. The goal is to be able
to model recognisably different civilizations (Hellenic city-states,
Rome, ancient Israel, the Philistines, Persia, Han China) and watch
those differences produce different histories on the same island.

## 1. The core distinction: traits vs progress

Two layers, deliberately separate — mirroring the tribe/settlement
split already in the codebase:

- **Traits** are *dispositions*: who a people are. They change slowly
  (generational drift, or as a lagging consequence of history). Traits
  are causes.
- **Progress** is *attainment*: what a people have achieved or become.
  Technologies, era, governance, artistic and philosophical
  development. Progress changes through simulation events. Progress is
  effect — and then feeds back (e.g. writing accelerates learning).

Nothing in the progress layer is ever stored when it can be derived
from traits + history; nothing in the traits layer is ever a
consequence the sim should compute. One source of truth each way.

## 2. Traits (dispositions)

All traits are scalars in 0..1, with 0.5 as the human baseline. Stored
per tribe in `tribe.traits`:

| Trait | Meaning | Low (0) | High (1) |
| --- | --- | --- | --- |
| `cohesion` | In-group preference / solidarity | individualist, porous identity | tight identity, wary of outsiders |
| `dogmatism` | Attachment to received ideas | open to novelty | resistant to new ideas |
| `physicality` | Average physical capacity | frail | robust |
| `acumen` | Average practical intelligence | slow to solve | quick to solve |
| `aggression` | Willingness to resort to violence | avoids conflict | seeks it |
| `mercantile` | Propensity to trade | autarkic | born traders |
| `artistry` | Propensity for art | utilitarian | expressive |
| `contemplation` | Propensity for philosophy/abstraction | concrete-minded | speculative |

Notes:

- **Traits interact rather than duplicate.** There is no stored
  "military bias" — it is *derived*:
  - `militaryBias = f(aggression, cohesion, physicality)`
  - `tradeBias = f(mercantile, 1 − cohesion, 1 − dogmatism)`
  - `learningBias = f(acumen, contemplation, 1 − dogmatism)`
  These three are normalised into a **posture triangle** (military /
  trade / learning weights summing to 1) used wherever the sim needs a
  quick answer to "what does this tribe prefer to do with surplus?"
- **Drift.** Each simulated decade, traits drift slightly (seeded
  noise, ±0.02), plus event-driven nudges: a generation at war raises
  `aggression` and `cohesion`; sustained trade contact lowers
  `dogmatism`; famine raises `cohesion`; prosperity raises `artistry`.
  Nudges are small — a people's character should be sticky, visible
  across centuries.
- **Individual variation is out of scope.** Traits are population
  averages; we are modelling peoples, not persons.

## 3. Progress (attainment)

Stored per tribe in `tribe.progress`:

### 3.1 Knowledge pools and eras

Three accumulating pools — `tech`, `art`, `philosophy` — fed each year
by **surplus**: population above subsistence, weighted by the posture
triangle and relevant traits.

```
surplus  = max(0, food gathered − food consumed)   (already implicit in capacity model)
techGain = surplus × learningBias × acumen
artGain  = surplus × artistry × (0.5 + prosperity)
philGain = surplus × contemplation × (1 − dogmatism)
```

**Era** is a function of technologies held, not of points:

1. **Paleolithic** (start) — foraging, primitive camps
2. **Neolithic** — requires *Agriculture*
3. **Chalcolithic** — requires *Copper Working*
4. **Bronze Age** — requires *Bronze Working* (needs copper **and tin
   access** — the ore provinces finally bite)
5. **Iron Age** — requires *Iron Working*

Era is therefore per-tribe: one people can be Bronze Age while their
neighbours still forage — which is exactly the asymmetry that makes
history interesting.

### 3.2 The technology tree

Small, hand-authored, heavily resource-gated. Techs have:
`{ id, name, cost, prereqs: [...], needsResources: [...], effects }`.

Initial tree (~20 nodes, deliberately compact):

- **Subsistence:** Fishing (fish tiles yield more) → Boats (coastal
  reach) · Agriculture (fertile/plains capacity ×2, unlocks Neolithic)
  → Irrigation (river valleys ×1.5) · Animal Husbandry (game →
  pasture)
- **Materials:** Flint Knapping (start) → Pottery (needs clay; storage
  smooths harsh winters) → Copper Working (needs copper) → Bronze
  Working (needs copper + tin) → Iron Working (needs iron; cheaper
  tools & weapons)
- **Civic:** Writing (needs philosophy pool threshold; accelerates all
  gains, enables Law) → Law (governance options) · Masonry (needs
  stone; settlement cap ×1.5, defensive bonus)
- **Exchange:** Barter Custom → Trade Routes (formalises trade
  relationships, wealth) → Currency (late)
- **Martial:** Organised Raiding → Professional Warriors → Fortifications
  (with Masonry)

Discovery each year is a seeded roll:

```
P(discover tech) ∝ techPool spend × (1 − dogmatism) × availability
```

where `availability` requires prereqs held **and required resources
inside the tribe's influence area or obtainable via a trade partner**.
That last clause is the engine of the whole phase: the tribe sitting
on the tin province becomes essential to every would-be Bronze Age
neighbour — trade or conquest are the only ways in, and which one a
tribe chooses is its posture triangle at work.

**Diffusion:** techs also spread by contact. Each year, for each tech
a neighbour holds: `P(adopt) ∝ contact intensity × (1 − dogmatism) ×
(1 − cohesion of the holder)`. Trade relationships multiply contact
intensity; wars expose techs too (slower, but real — captured smiths).

### 3.3 Governance

An enum ladder with trait-directed branching, evaluated when a tribe
crosses population/settlement thresholds:

- **Band** (start, < ~200 people)
- **Chiefdom** (any tribe above threshold)
- Then diverging by traits:
  - high `cohesion` + high `dogmatism` → **Theocracy** (stability
    bonus, innovation penalty)
  - high `aggression` + `cohesion` → **War-chief / Kingship**
    (military bonus, succession instability events)
  - high `contemplation` + low `dogmatism` → **Council rule**
    (proto-republic: innovation bonus, slower decisions — reduced
    crisis response)
  - high `mercantile` → **Merchant oligarchy** (trade bonus, cohesion
    erosion)
- Requires *Law* to reach the later forms; governance can regress on
  collapse events.

Governance affects: stability multiplier on growth, how many
settlements can be coordinated without penalty, and posture modifiers.

### 3.4 Artistic & philosophical development

Simple staged ladders driven by their pools, e.g. art: *none → craft
decoration → monumental works → distinctive style* (each stage adds
cohesion and, later, cultural influence radius); philosophy: *none →
oral tradition → cosmology → schools of thought* (each stage boosts
learning and unlocks Writing/Law earlier). Stages emit chronicle
events ("The Fenfolk raised standing stones at Galstead").

## 4. Archetypes: modelling real civilizations

A library of trait presets + a couple of starting-bias tweaks. Random
maps can draw tribes from archetypes (with ±0.1 jitter) or fully
random. Proposed presets (values indicative):

| Archetype | Signature | Key traits |
| --- | --- | --- |
| **Hellenic** | brilliant, fractious, seafaring | contemplation .9, artistry .8, acumen .8, mercantile .7, cohesion .3, dogmatism .2 |
| **Roman** | disciplined, expansionist, practical | cohesion .85, aggression .7, acumen .75, dogmatism .5, contemplation .4 |
| **Israelite** | covenantal, law-centred, resilient | cohesion .9, dogmatism .8, contemplation .8, mercantile .5, aggression .35 |
| **Philistine** | maritime, martial, mercantile | mercantile .8, aggression .65, physicality .7, artistry .55, cohesion .5 |
| **Persian** | administrative, tolerant, connective | acumen .7, mercantile .75, dogmatism .35, cohesion .6, contemplation .6 |
| **Han** | scholarly, centralised, industrious | acumen .85, contemplation .75, artistry .7, cohesion .75, dogmatism .6 |

The test of the model: run the same island with a Hellenic and a Roman
tribe adjacent, and the Hellenic one should out-invent, the Roman one
out-organise and out-fight, and which prevails should depend on
geography and luck — not be predetermined.

## 5. Inter-tribe dynamics (where traits meet)

Relationships get their own small state per tribe pair:
`{ stance: none|contact|trade|rivalry|war, familiarity, grievances }`.

- **Contact** begins when influence areas touch (already detected as
  "tension" — that event becomes the start of a relationship, not just
  a log line).
- **Disposition check** each year for each contact pair, driven by
  both sides' traits: mutual high `mercantile` + low `cohesion` →
  trade; high `aggression` + high `cohesion` (in-group preference) →
  raids → war. Dogmatic, cohesive tribes can also settle into stable
  *cold* rivalry — contact without exchange.
- **Trade** grants: shared resource access (tin!), wealth (a growth &
  art/phil bonus), faster tech diffusion, slowly falling `dogmatism`.
- **War** (initially raids, then conquest once one side holds a
  military tech edge): population loss scaled by military bias and
  bronze/iron gap; **settlement allegiance flips** on decisive raids —
  the payoff of the tribe/settlement separation. Conquered settlements
  keep their name and people but change `tribeId`, with an assimilation
  timer influenced by both tribes' cohesion.

## 6. Data model summary

```js
tribe = {
  id, name, color, alive,
  traits: { cohesion, dogmatism, physicality, acumen,
            aggression, mercantile, artistry, contemplation },
  archetype: 'hellenic' | ... | 'random',
  progress: {
    era: 'paleolithic' | 'neolithic' | 'chalcolithic' | 'bronze' | 'iron',
    techs: Set<string>,
    pools: { tech, art, philosophy },
    governance: 'band' | 'chiefdom' | 'theocracy' | 'kingship'
              | 'council' | 'merchant',
    artStage: 0..3, philosophyStage: 0..3,
  },
}
world.relations = Map<'a-b', { stance, familiarity, grievances }>
```

Derived, never stored: posture triangle, era (from techs), resource
access (from influence map + trade links).

## 7. UI

- **Tribe inspector:** click a tribe (panel row or chief settlement) →
  detail card: trait bars, posture triangle, era badge, tech list,
  governance, art/philosophy stages, relations summary.
- **Development view** (new map layer): territory coloured by era —
  the island visibly “lights up” as peoples advance at different
  rates.
- **Chronicle** grows event types: discoveries, era transitions,
  governance changes, trade pacts, raids, conquests, assimilation.
- Tribes panel rows gain era badge + posture glyph (⚔/⚖/📜).

## 8. Implementation phases

Each phase is shippable and testable on its own:

- **Phase A — Foundations (data + display).** Traits, archetypes,
  progress structure, tribe inspector UI. No behaviour change yet:
  the sim runs exactly as today, but peoples now *have* character.
  Headless tests: archetype determinism, trait jitter bounds.
- **Phase B — Knowledge & technology.** Pools, tech tree, discovery
  rolls, resource gating against the influence map, era transitions,
  capacity effects (Agriculture etc.), Development view. Test: a
  tin-province tribe reaches Bronze first; a high-dogmatism tribe
  lags a high-openness one on the same land.
- **Phase C — Relations.** Relationship state machine, trade (resource
  access + diffusion), raids/war, settlement allegiance flips,
  assimilation. Test: Hellenic-vs-Roman scenario above; tin monopoly
  produces either a trade network or a war for Cornwall.
- **Phase D — Society.** Governance ladder, art/philosophy stages,
  trait drift + event nudges, prestige/cultural influence feeding the
  influence map.

Throughout: every stochastic step uses forked seeded RNG streams
(`seed:trait-drift:year`, `seed:discovery:tribe:year`, …) so runs stay
fully reproducible, and everything remains in memory.

## 9. Open questions

1. **Time scale.** Real civilizational change is millennial; the sim
   currently steps decades comfortably. Proposal: keep 1 tick = 1 year
   but let the UI run centuries ("Simulate 100 years"), and tune tech
   pacing so Paleolithic → Iron takes ~500–1500 simulated years
   depending on traits and geography.
2. **Population scale.** Carrying capacities will need rebalancing as
   agriculture multiplies them — decide whether tribes should reach
   10⁴–10⁵ people (real Iron Age polities) or stay small and abstract.
3. **Trait mutability.** How much should a people be able to change?
   Suggested cap: no trait moves more than ~0.2 from its founding
   value per 500 years, keeping archetypes recognisable.
4. **Player intervention.** This phase is also where "the user makes
   adjustments" becomes rich: editing a trait, gifting a tech,
   brokering peace. Worth deciding which interventions to expose
   first.
