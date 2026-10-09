# Map Memory

A web app for learning maps, starting with the 50 US states.

## Modes

- **Explore**: hover for names, click a state for its capital and facts, color the map by how well you know each state, and list all states A–Z or by region.
- **Find it**: you're given a name; click the state.
- **Name it**: a state is highlighted; pick from four nearby options or type the name (one-letter typos are forgiven).
- **Drag & drop**: drag all the names onto the map. You can also tap a name, then tap the state.
- **History**: every finished quiz run, newest first, filterable by quiz and region. Expand a run to see which states you got on the 1st, 2nd or 3rd try or didn't get.

Explore and Find it can be zoomed (scroll, pinch, drag to pan, or the +/− buttons). Every quiz can be limited to one region, and the map zooms to fit it. Results are colored by try (1st, 2nd, 3rd, didn't get). The end-of-run summary shows each group with counts and percentages, and you can practice again the states you didn't get on the first try. Per-state stats, best scores and quiz history are saved in the browser's localStorage, so they stay on that device and browser.

## Run

```sh
npm install
npm run dev
```

## Adding another map (e.g. world countries)

Each map is a self-contained dataset under `src/datasets/<id>/`:

- `places.json` lists the places: `id` (must match the feature id in the map file), `name`, `code`, optional `capital`, `group` (region/continent), and optional free-form `facts` shown in Explore.
- `index.ts` holds a `DatasetConfig`: titles, groups, which TopoJSON to load, the projection (omit if the file is pre-projected), the viewBox, label tweaks, and callout boxes for places too small to click.

Register it in `src/datasets/registry.ts`. A map picker appears once there's more than one. Shapes and places load lazily, so each map's data is only downloaded when someone opens it.
