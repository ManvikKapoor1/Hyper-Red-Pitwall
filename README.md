# STINT — Strategy, Stint & Race Calls Manager

Desktop-first pitwall workstation for Le Mans Ultimate endurance racing: plan stints, manage fuel,
tires and virtual energy, and get suggested race calls from human-entered race data.
The pitwall decides and relays calls to the driver over its own voice chat — STINT never talks to the driver.

**Status:** work in progress. Calculation engine, data model, store and the Live Race screen are built;
other sections are stubs. See [HANDOFF.md](HANDOFF.md).

```bash
npm install
npm run dev     # open http://localhost:5173/#/app/race/demo-fuji/live
npm test
npm run build
```

All demo values are **SAMPLE DATA**, not authoritative LMU physics.
