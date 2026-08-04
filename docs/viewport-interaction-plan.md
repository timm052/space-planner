# BriefTrack — Viewport & Interaction Plan

> Companion to [ARCHITECTURE.md](ARCHITECTURE.md) and
> [diagram-environments-plan.md](diagram-environments-plan.md).
> Executed in phases; **pause for review after each phase** (verify in the
> browser preview + `npm test` + `npm run build` before moving on).

## Why

`BubbleTab.jsx` is 4,020 lines — more than double the ~1,950 that motivated the
environments decomposition. `DiagramCanvas.jsx` is 1,035. Interaction feels
heavy under load, and adding a feature to the viewport means touching a
mode-multiplexed pointer handler that has no isolated tests.

The diagnosis from reading the code is that **the cost is not in the renderer**.
SVG is doing element hit-testing for free, `toSvgCoords` is 15 lines, and the
wheel handler is already correct (non-passive, exponential, cursor-anchored).
The cost is in three places:

1. **Un-coalesced pointer work** — `onMove` runs in full and calls `setTick` on
   every `pointermove`, several times per frame on modern input devices.
2. **No scene abstraction** — `DiagramCanvas` derives geometry *and* renders it,
   and `pdfExport.js` re-derives the same geometry independently.
3. **An implicit mode machine** — pan / marquee / bubble-drag / vertex-drag /
   seed-drag / layer-move / calibrate / link-drag multiplexed through
   `dragRef` / `marqueeRef` / `panRef` and mode flags, inline in the component.

None of those get better by swapping SVG for WebGL; (1) and (3) get *worse*,
because you would also own picking and text layout. So this plan fixes the
layers that are actually expensive and leaves the renderer decision until
after a scene layer exists — at which point it becomes a contained swap.

## Branch strategy

We are on `refactor/diagram-decomposition`, **10 commits ahead of `main`**,
including the 6,400-line Brief/formula commit. Land that before starting Phase 2
or later. Stacking a second large refactor on an unmerged branch of this size
compounds review and bisect risk. Phases 0–1 are small enough to go either way.

---

## Phase 0 — Ground truth

Nothing below is verifiable until the suite runs.

- `npm install` — `node_modules` is absent, so `npm test` currently fails on
  `Cannot find package 'tsx'` for every file. Confirm green, and confirm
  `npm run build`.
- Local Node is v25.7.0; CI pins `22.x`. Confirm the suite passes on both, or
  pin local to `.nvmrc`.
- **Capture a performance baseline** before changing anything: frame timings
  during a sustained bubble drag with the sim running, at ~50, ~150 and ~400
  rooms. Without this, Phase 1's payoff is unmeasurable and Phase 4 is guesswork.
- **Documentation catch-up.** Commit `6e94c65` shipped the entire Brief
  subsystem with no doc changes. ARCHITECTURE §3's repo map is missing
  `ProgramTab.jsx`, `DesignTab.jsx`, `formula.js`, `benchmarks.js`,
  `server/brief.js`, `options.js`, `changelog.js`; §4's data model is missing
  `brief_spaces`, `brief_revisions`, `brief_adjacencies`, `design_options`,
  `change_log`; README's API table is missing ~20 endpoints. This is Phase 0
  because ARCHITECTURE is the file the repo instructs agents to read first —
  every later phase is degraded while it is wrong.

### Baseline — recorded

`npm test` 297 pass / 0 fail · `npm run build` clean · `npm run lint` 0 errors,
22 pre-existing warnings. Node v25.7.0 local, CI on 22.x.

`node --import tsx scripts/perf-bench.js` — 60 pointermoves per drag:

| rooms | rectCalls | rect/move |  ms |
| ----- | --------- | --------- | --- |
|    50 |       121 |      2.02 |  14 |
|   150 |       121 |      2.02 |  22 |
|   400 |       121 |      2.02 |  60 |

**2.02 `getBoundingClientRect()` calls per pointer move**, confirming the
diagnosis exactly: one at the top of `onMove` plus one inside each
`toSvgCoords`. In a browser each is a forced synchronous layout, on the hot
path, while the sim runs.

Bundle note for the Phase 5 three.js decision: `Stacked3D` builds to
**857 kB (234 kB gzip)** — comfortably the heaviest chunk in the app.

**Exit:** green `npm test` + `npm run build`, a recorded baseline, accurate docs.
✅ **Done.**

---

## Phase 1 — Smoothness wins with no new dependencies

Contained, low-risk, and diagnostic: it tells us how much of the roughness was
ever an animation problem before we add libraries for it.

- **Coalesce pointer moves to one rAF.** `onMove`
  ([BubbleTab.jsx:1873](../src/components/BubbleTab.jsx)) stashes the latest
  event and schedules a frame; the frame does the work and the single `setTick`.
  Preserves ordering, drops redundant renders. Use `getCoalescedEvents()` where
  intermediate positions matter (marquee, freehand vertex drag) so precision
  isn't lost.
- **Cache the client rect.** `onMove` computes
  `getBoundingClientRect()` at the top, then every `toSvgCoords(e)` call inside
  it ([BubbleTab.jsx:1813](../src/components/BubbleTab.jsx)) computes it again —
  a forced synchronous layout, twice per move, during a drag, while the sim
  runs. Cache on pointer-down; invalidate from the `ResizeObserver` already in
  [useViewport.js](../src/hooks/useViewport.js) and on scroll.

**Exit:** measurable frame-time improvement against the Phase 0 baseline at
150+ rooms. Existing interaction tests still pass.

---

## Phase 2 — The pointer mode machine

The actual complexity, and it is renderer-independent — which is why it comes
before any scene or renderer work.

- **Characterization tests first.** `test/bubbletab.interactions.test.js` has 7
  jsdom pointer tests (drag, marquee, link mode, calibration) on top of
  `test/helpers/dom.js`. That is a foundation, not a net. Extend it to cover
  every mode and every transition *before* moving code — vertex drag, seed drag,
  layer move/rotate, right-drag pan, space-held pan, shift-additive marquee,
  group drag, snap variants.
- **Extract `diagram/modes.js`** — a pure, explicit state machine: current mode,
  legal transitions, and per-mode `down` / `move` / `up` reducers over an
  event + scene context, returning intent (not DOM effects). Follows the
  existing pure-module precedent (`selection.js`, `layerTools.js`, `linking.js`,
  each with its own test file).
- `BubbleTab` keeps the DOM plumbing (pointer capture, listeners) and applies
  the intents the machine returns.
- Annotate the new module with **JSDoc + `checkJs`** rather than migrating to
  TypeScript. Brand the coordinate types (`Metres`, `DiagramUnits`,
  `NaturalPx`, `ScreenPx`) so ARCHITECTURE §6's invariants are checked by the
  compiler instead of only documented. ROADMAP already sanctions this hedge.

**Risk:** highest in the plan. Pointer behaviour is subtle and currently
under-tested. Mitigated entirely by doing the tests first — do not skip that.

**Exit:** `modes.js` unit-tested in isolation; `BubbleTab` materially smaller;
no behavioural change observable in the preview.

---

## Phase 3 — The scene layer

The right abstraction already exists in the best-factored file in the diagram:
[scenes.js](../src/components/diagram/scenes.js) exports `buildStackScene` and
`build3DScene` — pure functions from domain state to renderer-agnostic
geometry, with two renderers consuming them. Generalise that rather than
replacing anything.

- **Promote `scenes.js` to the scene layer for all three environments.** Pure
  builders (Concept, Master plan, Building) emitting primitives in **diagram
  units** — the unit that makes PDF scale accuracy exact today.
- **Make `DiagramCanvas` dumb.** It consumes scene primitives and emits SVG.
  Derivation moves out; rendering stays.
- **Point `pdfExport.js` at the same scene** instead of re-deriving geometry.
  This removes a whole class of "the PDF doesn't match the screen" bugs, and is
  the clearest single argument for the phase.
- Keep the 574 selectors in `diagram.css` driving appearance. Scene primitives
  carry semantic state (`selected`, `dim`, `related`, `tight`), not colours —
  theming stays in CSS, where commit `e67e38b` showed it belongs.

**Exit:** one scene definition per environment; canvas and PDF render from it;
existing PNG/PDF exports byte-comparable or visually identical.

---

## Phase 4 — Springs for view transitions

Only now, with Phase 1 done, do we know what is left to fix.

- Add **`@react-spring/web`** and replace the hand-rolled `stepTween` /
  `viewTweenRef` ([BubbleTab.jsx:2194](../src/components/BubbleTab.jsx)).
  Springs are interruptible by construction — grabbing the canvas mid-flight
  retargets smoothly instead of fighting the gesture.
- Use the **imperative API** (`SpringValue` / `api.start`) writing directly to
  SVG attributes, so view animation stays outside React renders and matches the
  bypass architecture `useTick.js` already implements.
- Scope: view transitions only — pan/zoom easing, fit-to-view, environment
  switches, camera presets, selection focus. **Not** the force sim, which is its
  own integrator and stays hand-rolled.
- **Honour `prefers-reduced-motion`.** It is already supported per ROADMAP;
  every spring added must respect it or we regress a shipped accessibility
  feature.

**Exit:** no hand-rolled tweens left in the viewport; reduced-motion verified.

---

## Phase 5 — Conditional, decide with evidence

Do not pre-commit to these. Each has a trigger.

- **`@use-gesture/react`** (~5kb) — normalizes pointer/touch/wheel/pinch and
  supplies velocity, inertia, drag thresholds and rubberband bounds. Slots in
  *alongside* Phase 2: the library handles input normalization, `modes.js`
  handles intent. **Trigger:** wanting momentum/inertia on pan, or touch
  support becoming a requirement.
- **Worker + `comlink` for the force sim.** No animation library fixes main-
  thread contention; ROADMAP already flags this. **Trigger:** Phase 0's baseline
  showing sim/render contention at the room counts real projects hit.
- **The three.js decision.** `scenes.js` currently maintains `buildStackScene`
  (SVG isometric, rebuilt in `fa132e8`) *and* `build3DScene` (WebGL) — two
  answers to "show the floors stacked", in parallel. After Phase 3 the cost of
  each is finally legible. Either drop the WebGL path and shed the heaviest
  dependency, or keep it because a continuous 2D↔3D camera is wanted — which is
  the one thing SVG genuinely cannot do. **Decide after Phase 3, not before.**

---

## Explicitly not in this plan

Discussed and worth doing, but off the critical path for viewport work —
separate pieces, so they don't inflate this one:

- **Vitest migration.** Would remove the `tsx` classic-runtime hack that forces
  component tests to set `globalThis.React` (ARCHITECTURE §9). Real, but it
  touches ~20 test files and blocks nothing here.
- **Full TypeScript migration.** Phase 2 takes the high-value slice via JSDoc.
- **Images to disk beside the DB** — a known ROADMAP limitation and the reason
  `serialize.js` strips blobs from the refetch.
- **`@layer` for the CSS cascade**, replacing "import order IS the cascade".
- **`node:sqlite` vs desktop packaging.** Requires Node ≥ 22.5; Electron's
  bundled Node may lag, and Tauri has no Node at all. Needs deciding before
  desktop work starts, not before viewport work.
