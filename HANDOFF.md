# STINT — build handoff

Status at this checkpoint, so a new session can continue without re-deriving context.
Full product brief: the original request (STINT pitwall strategy workstation for Le Mans Ultimate).

## Done

**Calculation engine** (`src/engine/`, UI-free, tested with vitest)
- `types.ts` — domain model (race, car setup, drivers, strategy plan, versions, live state, calls, events, settings). Internal units: s / ms / litres / % / °C / km.
- `model.ts` — per-lap primitives: fuel/energy per lap, tire degradation, lap prediction, pit loss (with service concurrency), pit templates.
- `simulate.ts` — `calculateStrategy()` lap-by-lap simulation (pre-race and from a live state), pit windows, EARLY/OPTIMAL/LATE flags, issues.
- `live.ts` — measured rates (stint / race / last-N / user), confidence, `projectLive()`, race state machine, `liveSimOptions()`.
- `calls.ts` — `generateRaceCalls()` with priorities, reasons, confidence, alternatives and actions; `deriveAlerts()`.
- `validate.ts` — manual-input validation (lap/time/fuel/tire/energy/lap-time conflicts).
- `planner.ts` — plan editing, `buildPlan()`, `autoBalance()` (even / max-first).
- `alternatives.ts` — alternatives + `compareStrategies()` with neutral tags; `pitNowOption()` for SC/slow-zone.
- `liveOps.ts` — quick update, record pit stop, grid/start reducers.
- `demo.ts` — seeded demo lap feed; `analysis.ts` — post-race planned vs actual; `factory.ts` — defaults.
- `src/data/samples.ts` — SAMPLE DATA: 6H Fuji live demo (#27 + #28), finished 4H Spa, upcoming 24H Le Mans draft.

**State** — `src/store/store.ts` (zustand + localStorage via `persistence.ts` adapter; swap for a backend later).

**UI done**
- Design tokens/themes (`src/styles/tokens.css`), primitives (`base.css`, `components/ui.tsx`, `components/icons.tsx`).
- App shell + sidebar (`components/AppShell.tsx`), routes (`App.tsx`, HashRouter).
- **Live Race screen** (`pages/LiveRace.tsx`) — header, current stint, race state machine, quick update with validation modal, strategy timeline, upcoming stints, call queue, scenarios (SC/SZ/FCY/VSC/RED/RAIN/DRY/CUSTOM) with after-event comparison, alerts, next-call card (confirm / alternative / override), pit window (accept / override), fuel / tires / energy / pace cards, call history, pit-stop recorder, demo controls (clock, speed, advance lap), hotkeys (U, L, Space, C, O, P, F). Verified at 1920×1080 with no page scroll.

## Remaining (in priority order)

1. **Live screen polish** — Fuel card method selector overflows the bottom row (move selector into the panel header); fill spare space (center-mid, left column) with lap-trace charts: lap time, fuel/lap, energy/lap vs assumption (separate small charts, one axis each).
2. **Strategy section** (`pages/strategy/StrategyPage.tsx` is a stub) with tabs: Builder (vertical START→STINT→PIT→FINISH timeline, stint editor: add/delete/duplicate/reorder, driver/tire/fuel/length/energy/mode), Stint planner table, Pit stops (templates FUEL ONLY … EMERGENCY/CUSTOM), Fuel, Tires (deg curves, Option A/B/C comparison), Energy, Alternatives (`compareStrategies`), Simulation (planned scenarios via `race.plannedEvents`, time-axis timeline), Timeline (zoomable, plan vs actual lanes), Versions (`saveVersion` / `restoreVersion`).
3. **Other pages** (stubs): Dashboard (race cards, create/open/demo), Race Setup (all race/car/pit/energy fields), Calls (board + history with status changes + manual call), Data (assumptions panel with measured/assumed tags, drivers, lap table edit, library, JSON export/import), Analysis (`postRaceSummary`), Settings (units, time format, theme, defaults, alert thresholds), Landing page.
4. Quality passes (`/code-review`, `/simplify`), SessionStart hook for web sessions, README screenshots.

## Design rules in force
- Colour only for race-critical state: green OK, amber warning, red critical, blue info/alternative, violet = energy.
- Driver colours: `DRIVER_COLORS` in `engine/factory.ts`, validated with the dataviz palette validator (dark surface, adjacent CVD ΔE ≥ 8). Driver blocks always carry a text code as secondary encoding.
- Charts: one y-axis per chart, 2px lines, bars ≤ 24px, hairline grids, hover tooltips, legend for ≥ 2 series.
- Never invent data: every projection derives from entered values, explicit assumptions or calculations; demo numbers are labelled SAMPLE DATA.

## Run / verify
```bash
npm install
npm run dev        # http://localhost:5173/#/app/race/demo-fuji/live
npm test           # engine tests
npm run build
```
Headless screenshot (Playwright is installed globally in the cloud container):
`node <script> "http://localhost:5173/#/app/race/demo-fuji/live" out.png 1920 1080` using `chromium.launch({ args: ['--no-sandbox'] })`.
Reset stored data in the browser via Settings → reset (to be built) or `localStorage.removeItem('stint.v1')`.
