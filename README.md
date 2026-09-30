# STINT — Strategy, Stint & Race Calls Manager

Desktop-first pitwall workstation for Le Mans Ultimate endurance racing: plan stints, manage fuel,
tires and virtual energy, and adjust the strategy mid-race with predictions of where to gain —
all from human-entered race data. STINT is a strategy tool, not a telemetry viewer.
The pitwall decides and relays calls to the driver over its own voice chat — STINT never talks to the driver.

- **Plan** — race setup, stint builder, pit stops, fuel / tire / energy margins, alternatives, planned scenarios, versions.
- **Live** — quick updates each lap, measured consumption, re-projected pit windows, suggested calls and
  **Where to gain** (options re-simulated from the current lap with gain, risk and confidence).
- **Review** — calls log, assumptions vs measured, planned vs actual analysis.

```bash
npm install
npm run dev     # open http://localhost:5173/#/app/race/demo-fuji/live
npm test
npm run build
```

All demo values are **SAMPLE DATA**, not authoritative LMU physics. See [HANDOFF.md](HANDOFF.md) for architecture and status.
