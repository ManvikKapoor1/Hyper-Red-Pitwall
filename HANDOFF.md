# STINT — build handoff

Status at this checkpoint, so a new session can continue without re-deriving context.
Product: STINT pitwall strategy workstation for Le Mans Ultimate — strategy planning and
mid-race strategy adjustment. **It is not a telemetry viewer**: per-lap data is only an input
to projections, never a live chart.

## Done

**Calculation engine** (`src/engine/`, UI-free, tested with vitest — `src/engine/__tests__/engine.test.ts`)
- `types.ts` — domain model. Internal units: s / ms / litres / % / °C / km.
- `model.ts` — per-lap primitives: fuel/energy per lap, tire degradation, lap prediction, pit loss, templates.
- `simulate.ts` — `calculateStrategy()` lap-by-lap simulation (pre-race and from a live state), windows, flags, issues.
- `live.ts` — measured rates, confidence, `projectLive()`, race state machine, `liveSimOptions()`.
- `calls.ts` — `generateRaceCalls()` / `deriveAlerts()`.
- `opportunities.ts` — **Where to gain**: `findOpportunities()` re-simulates every option open from the current
  lap (stop count, tire pattern, stint length, fuel save, box under an active SC / slow zone) with measured rates;
  returns predicted gain over the same distance, what changes, risk relative to the current plan, confidence.
- `alternatives.ts` — alternatives + `compareStrategies()` (neutral tags), `pitNowOption()`.
- `planner.ts` — plan editing, `buildPlan()`, `autoBalance()`, `withTirePattern()`, `renameCompoundInPlan()`.
- `whatif.ts` — fuel / energy sensitivity (scales the sim base rate, so per-driver values scale too), tire options A–D.
- `assumptions.ts` — entered vs measured (normalised against the plan's per-lap assumption; timed stops only),
  `adoptMeasured()` keeps driver offsets; `driverStats()`.
- `trace.ts` — recorded lap paired with the plan assumption (used by assumptions + Analysis).
- `validate.ts`, `liveOps.ts`, `demo.ts`, `analysis.ts`, `factory.ts`, `format.ts`.
- `src/data/samples.ts` — SAMPLE DATA: 6H Fuji live demo (#27 + #28), finished 4H Spa, 24H Le Mans draft.

**State** — `src/store/store.ts` (zustand + localStorage via `persistence.ts`). Actions include
`adoptAssumption`, `renameCompound` (cascades to plan + live data), import shape validation.

**UI** (all checked in Chromium at 1920×1080)
- Landing (`/`), Dashboard, Race Setup, Strategy (10 tabs: Builder, Stints, Pit stops, Fuel, Tires, Energy,
  Alternatives, Simulation, Timeline, Versions), Live Race, Calls, Data, Analysis, Settings.
- Live Race fits 1920×1080 with no page scroll: header, current stint, race state, quick update, strategy
  versions, timeline, upcoming stints, **Where to gain** (Apply → replaces remaining stints, saves a version,
  logs a call), scenarios + alerts, next call, pit window, call queue, fuel / tires / energy / pace, call history.
- Shared chart: `components/charts/LineChart.tsx` (one axis, crosshair tooltip). Used for plan fuel / energy
  levels, tire degradation small multiples and post-race Analysis — not on the Live screen.
- `.claude/hooks/session-start.sh` installs npm dependencies in web sessions.

## Remaining / ideas
1. Optional cleanup pass (`/simplify`) — not run yet.
2. `alternatives.ts` "EXTENDED STINTS" option sizes stints from the entered fuel rate, so mid-race it can run
   dry (Where to gain marks it HIGH risk and disables Apply). Sizing from `sim.fuelPerLapL` would make it usable.
3. README screenshots.

## Design rules in force
- Colour only for race-critical state: green OK, amber warning, red critical, blue info/alternative, violet = energy.
- Driver colours: `DRIVER_COLORS` in `engine/factory.ts` (validated palette — do not change). Driver blocks carry a text code.
- Charts: one y-axis per chart, 2px lines, hairline grids, hover tooltips, legend for ≥ 2 series.
- Never invent data: projections come from entered values, explicit assumptions or calculations; demo values are SAMPLE DATA.
- Engine logic lives in `src/engine`; pages call engine functions and the store.

## Run / verify
```bash
npm install
npm run dev        # http://localhost:5173/#/app/race/demo-fuji/live
npm test           # engine tests
npm run typecheck
npm run build
```
Headless screenshot (Playwright installed globally in the cloud container):
`chromium.launch({ args: ['--no-sandbox'] })` from `/opt/node22/lib/node_modules/playwright`, viewport 1920×1080.
Reset stored data via Settings → Reset all data (or `localStorage.removeItem('stint.v1')`).
