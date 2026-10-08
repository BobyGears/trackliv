# TrackLiv

Live crew & vehicle dispatch and schedule tracking for **DTE GmbH**, Flörsheim am Main.

TrackLiv shows every project in the Rhein-Main region on one map. Both HQs, **Schieferstein 4** and **Hafenstraße 18**, are rebuilt in 3D at true scale from their real building footprints. Vehicles come in live from **FleetGO**. Each vehicle gets a crew of 1–4 people and a destination: a project from the list, or a custom place. A **Randomize** button builds the day's plan for you, and anything you've pinned stays where it is.

![Overview](docs/screenshots/overview.jpg)

| True-scale 3D HQ | Dispatch board |
| --- | --- |
| ![HQ in 3D](docs/screenshots/hq-3d.jpg) | ![Dispatch](docs/screenshots/dispatch.jpg) |
| **Randomize scenario (pins are kept)** | **Schedule / Gantt** |
| ![Randomize](docs/screenshots/randomize.jpg) | ![Schedule](docs/screenshots/schedule.jpg) |

## Quick start

```bash
npm install
npm run dev          # API on :8787 + web on :5173
open http://localhost:5173
```

Requires Node 20+. Without FleetGO credentials it starts in **simulator mode**. The demo fleet then drives the real road network on a randomized demo plan for today. On restart the simulator replays the day so far, so positions, stages and the event log stay consistent.

Production: `npm run build && npm start` (one process on `PORT`, default 8787, which serves both the API and the built web app).

## What you can do

**Map (default view).** A regional overview that fits all projects, with HQs, project markers (crew on site, en route) and planned road routes. Zoom into an HQ, or pick it in the HQ switcher, to fly into the **true-scale 3D model**. You'll see the real building footprint and height, loading docks, the yard with parking bays, every vehicle as a 3D model at its GPS position, and the crew standing next to their vehicle (or waiting at the muster point when nobody has assigned them yet). The panels follow the layout of an operations twin:
- **KPI cards**: crew deployed, vehicles out, on-time departures, projects covered.
- **Object panel**: Palantir-style property sheet for any vehicle, person, project or HQ, with linked objects you can pivot through.
- **Run tracking**: a stepper from *Crew ready → Departed → On site → Returning → Back at HQ*, with actual times and ETA.
- **Live list**: tabs for vehicles, crew, projects and events.

**Dispatch board** (`2`)
- Drag people onto vehicles. Each vehicle holds 1–4 people, limited by its seats.
- Click a destination to open the **project list** (search, distance, crew vs. target, priority). A custom destination can be:
  - a free label,
  - an address search,
  - a pin dropped on the map.
- **Pin** (🔒) a person, a destination, or a whole vehicle.
- **Send to a task**: tick a few people → *Send to a task & pin*. They ride together on the best free vehicle, and both crew and destination are pinned.
- **Randomize**: everyone else is grouped at random and sent to random active projects. You get a scenario preview first, as a diff, with a reproducible seed, *Reroll* and *Apply*. Rules:
  - every vehicle needs a licensed driver (B / BE / C1 / C1E / C / CE hierarchy),
  - every active project gets covered first, then the rest is spread by priority,
  - preferred crew size, and people prefer their own depot,
  - you can top up pinned crews or leave them exactly as pinned,
  - you can limit it to one depot.

  Vehicles already on the road are never touched.
- Plan **tomorrow** or any other day, or *Copy today*. Undo/redo with `⌘Z` / `⌘⇧Z`. Every change is written to the audit log with your name.

**Schedule** (`3`): a Gantt chart of departures and returns per vehicle, with the actual en-route, on-site and returning times from GPS and a live "now" line. Drag a bar to move a run, or drag its edges to change the times.

**Tracking.** A geofence state machine moves each run through its stages automatically from the GPS positions:
- *departed* when the vehicle leaves its HQ (110 m geofence),
- *on site* within 250 m of the destination,
- *returning* once it is 450 m away again,
- *back at depot*.

It raises alerts when a crewed vehicle hasn't left 15 minutes after its planned time, or leaves without an assignment.

Also: a command palette (`⌘K`), dark "ops" mode, and live multi-user updates over SSE (several dispatchers can work at once, with optimistic updates and conflict retry).

| Key | Action |
| --- | --- |
| `⌘K` / `/` | Search & commands |
| `1` `2` `3` | Map / Dispatch / Schedule |
| `R` | Randomize (preview) |
| `F` | Fit all projects |
| `⌘Z` / `⌘⇧Z` | Undo / redo |
| `Esc` | Close / deselect / cancel |

## FleetGO

Copy `.env.example` to `.env` and fill in:

```
FLEETGO_CLIENT_ID=…
FLEETGO_CLIENT_SECRET=…
FLEETGO_USERNAME=…
FLEETGO_PASSWORD=…
```

FleetGO issues API keys on request (info@fleetgo.com). The server logs in with `POST /api/session/login`, then polls `GET /api/equipment/Getfleet` every `FLEETGO_POLL_SECONDS` (30 s by default). These are the endpoints the open-source RitAssist/FleetGO client and the Home Assistant `fleetgo` integration use. All paths are configurable in `.env` in case your account is on a newer API version. Field parsing is tolerant to naming variants. The integration is tested against sample payloads (`apps/server/src/fleetgo.test.ts`), but not yet against a live account, so check the first sync.

- FleetGO vehicles are matched to TrackLiv vehicles by FleetGO id, or by licence plate (`MTK-DT 103` = `MTKDT103`).
- Unknown vehicles are **imported automatically** (`FLEETGO_AUTO_IMPORT`). The import guesses vehicle type, seats, licence class and home HQ from make, model and position.
- In live mode the simulator is off, and stages come from real GPS.

## Data

- **Master data, plans and the audit log** live in `apps/server/var/db.json`. On first start, `TRACKLIV_SEED=demo` fills it with demo crew, vehicles and projects. The demo project locations are real Rhein-Main streets (no house numbers); the names and clients are fictional. To start from scratch, delete the file or set `TRACKLIV_SEED=empty`.
- **Geodata** (`data/geo/`) is generated from [Overture Maps](https://overturemaps.org) (release 2026-09-23):
  - `hq-*.geojson`: every building with height, streets, rail, yards and water within about 1 km of both HQs.
  - `region-*.geojson`: an offline Rhein-Main basemap (towns, motorways, primary and secondary roads, rail, rivers, forest and urban areas). No tile server or API key is needed.
  - `road-graph.json`: a routable road graph (~69k nodes) for ETAs, planned routes and the simulator.
  - `sites.json`: HQ address points, building footprints, yard bays and gates. You can hand-edit yard bays here.

  The address points come from the official Hessen address register, through Overture and OpenAddresses. Regenerate with:

  ```bash
  pip install pyarrow shapely
  python3 scripts/geo/fetch_overture.py   # reads only the needed parquet row groups from S3
  python3 scripts/geo/build_geodata.py
  ```

## Architecture

```
packages/core   Shared TypeScript domain: types, assignment rules, randomizer, geofence stages,
                road-graph routing (A*). Unit-tested with Vitest.
apps/server     Node + Express API: JSON store, FleetGO client & poller, simulator, SSE hub,
                geodata serving (pre-gzipped), Nominatim proxy for address search.
apps/web        React 19 + Vite + Tailwind 4. MapLibre GL renders the offline basemap and 3D
                buildings; a three.js custom layer renders the HQ models, vehicles and crews.
scripts/geo     Overture extraction pipeline (Python).
```

`npm test` runs the domain and FleetGO tests. `npm run typecheck` checks all packages. `npm run screenshot -- out.png` captures the running app with headless Chromium.

## Licences & attribution

The map data is © OpenStreetMap contributors (ODbL) and Microsoft building footprints (ODbL), via the Overture Maps Foundation. The address points come from the Hessen address register (DL-DE-ZERO-2.0). Map label glyphs use Noto Sans (SIL OFL, see `apps/web/public/fonts/OFL.txt`).
