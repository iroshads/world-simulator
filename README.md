# World Simulator v2

Real-time multi-agent sandbox — the research groundwork for Marketrix's simulation engine.
Four live domains, one dark mission-control shell, all running custom agent logic on Three.js.

## Domains

### 🌍 World (flagship)
A living city on procedurally generated terrain (rivers, lakes, forests, elevation):
- **Economy** — treasury, build costs, tax income vs. service upkeep; RCI supply-and-demand drives zone development
- **Infrastructure** — drag-paint roads (zones need road access), power plants with coverage radius + grid capacity (blackouts are real)
- **Agents** — cars pathfind your actual road network (BFS), pedestrians wander streets and parks
- **Environment** — pollution emission/diffusion/absorption, land value, per-building happiness
- **Time & weather** — full day/night cycle (lit windows, street lamps), drifting clouds, rain fronts that suppress fires
- **Disasters** — spreading fires, meteor strikes with craters and firestorms
- **Data overlays** — land value / smog / mood heatmaps

### 🚗 Traffic
Nine signalized intersections running **IDM (Intelligent Driver Model)** car-following physics.
Green-wave phase offsets, queue-actuated adaptive signals, aggression-driven red-light running,
persistent wrecks that block lanes, click-to-override any intersection.

### 🤖 Robotics
Autonomous warehouse fleet (up to 8 humanoids) sharing one task queue: A* pathfinding with
dynamic robot-avoidance, pick → carry → deliver pipeline, per-robot batteries with self-managed
charging. Build shelving live and watch them re-route.

### 👥 Social
Continuous opinion dynamics (bounded-confidence model) on a rewiring graph. The recommender
algorithm ("feed strength") preferentially connects similar & popular accounts — echo chambers
*emerge*. Inject bots, trigger viral posts, deploy fact-checks, ban accounts.

## Shell
Global pause / 1× / 2× / 4× time controls (Space), scenario presets per domain, live metric
chips, trend sparklines, severity-coded event log, hover inspection tooltips, right-drag orbit +
scroll zoom, keyboard shortcuts (1-4 domains, +/− zoom).

## Run

```bash
npm install
npm run dev   # http://localhost:3000
```

Made with ❤️ by [Irosha de Silva](https://www.irosha.com) in San Francisco.
