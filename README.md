# Map Memory

A web app for learning maps, starting with the 50 US states.

## Modes

- **Explore**: hover a state for its name and capital; click it (or pick it from the A–Z / by-region list) to zoom in and see its capital, facts, a few "Did you know?" fun facts with links to their sources, and four photos: state flag, flower, bird and a famous landmark. Capitals are marked with ★, with names shown for the selected state and once zoomed in. "Color by how well I know them" shades each state by your quiz results.
- **Find it**: you're given a name; click the state.
- **Name it**: a state is highlighted; type its name or pick from four nearby options.
- **Drag & drop**: drag every name onto its state, or tap a name, then tap the state.
- **Capitals**: a state is highlighted and named; type its capital or pick from four nearby capitals. Only shown for maps that have capital data.
- **History**: every finished quiz run, newest first, filterable by quiz and region. Expand a run to see which states you got on the 1st, 2nd or 3rd try or didn't get.

### How quizzes work

- **Starting and timing:** press **Start quiz** to begin. The timer pauses on **Pause**, when you leave the browser window (press **Resume quiz** to continue), and while you're on another tab. Switching tabs keeps your progress.
- **Regions:** every quiz can be limited to one region, and the map zooms to fit it. Explore and Find it can also be zoomed (scroll, pinch, drag to pan, or the +/− buttons).
- **Answering:** you get 3 tries per state, and results are colored by try (1st, 2nd, 3rd, didn't get). Typed answers forgive one-letter typos and "St." for "Saint".
- **Summary:** the end-of-quiz summary shows counts and percentages per try, and offers to practice the states you didn't get on the first try. Practice runs are marked in History and never count as best scores.
- **Sounds:** right and wrong answers play a sound. Mute with 🔊 in the header.
- **Keyboard:** Tab to a state and press Enter to pick it. In Drag & drop, press Enter on a name, then Enter on its state.

### Settings and saved data

- **Theme:** choose **Light**, **Dark** or **Auto** (follows your system) in the header.
- **Saved in the browser's localStorage**, so it stays on that device and browser:
  - per-state results, kept separately for the map quizzes and the Capitals quiz
  - best scores and quiz history
  - your theme and mute choice
- **Explore coloring** counts the Capitals quiz only while its Capitals checkbox is on. Its note says which quizzes are included.
- **Reset progress** (in Explore) clears results, best scores and history.

## Run

```sh
npm install
npm run dev      # local dev server
npm run build    # type-check and build to dist/
npm run lint     # oxlint
npm run preview  # serve the built app
```

## Adding another map (e.g. world countries)

Each map is a self-contained dataset under `src/datasets/<id>/`, registered in `src/datasets/registry.ts`. A map picker appears once there's more than one. Shapes, places and photos load only when that map is opened.

- **`places.json`** lists the places:
  - `id` must match the feature id in the map file.
  - `name`, `code` and `group` (region or continent) are required.
  - `capital` and `capitalLocation` (`[longitude, latitude]`) are optional.
  - `facts` is an optional list of extras shown in Explore.
  - `funFacts` is an optional list of `{ text, source }` trivia for Explore's "Did you know?" section, where `source` is the page the fact was checked against.

  The Capitals quiz, the capital stars and the other capital controls appear only when places have a `capital`. Places without one are left out of the Capitals quiz.
- **`index.ts`** holds a `DatasetConfig`:
  - titles, groups, and the TopoJSON to load
  - `projection`, or for a pre-projected map like `us-atlas`'s Albers files, `pointProjection` (used to place capitals)
  - `viewBox`
  - `labelOverrides`, for label positions the geometric center gets wrong
  - `callouts`, for clickable boxes beside places too small to click
  - `insets`, for places drawn away from their region, like Alaska and Hawaii, which move next to it when the region is zoomed
- **`images.json`** (optional, via `loadImages`): photos per place id. Each entry has a caption, image links, the credit and license, and source links. If it fails to load, the map still works without photos.

## Data sources

- **State facts** (capital, largest city, statehood, nickname) were checked against Wikipedia's US state lists.
- **State flowers and birds** were checked against Wikipedia and [50states.com](https://www.50states.com/).
- **Fun facts** (three per state) were each checked against the Wikipedia article they link to.
- **Capital locations** come from Wikidata, and each was confirmed to fall inside its state.

## Photos

All photos are freely licensed images from [Wikimedia Commons](https://commons.wikimedia.org/), linked rather than bundled. Each photo's photographer and license are shown with it, as the licenses require.

- **Flags:** each state's official flag image on Wikidata. All are public domain or free use.
- **Birds and flowers:** the photos from each state's row in Wikipedia's [state bird](https://en.wikipedia.org/wiki/List_of_U.S._state_birds) and [state flower](https://en.wikipedia.org/wiki/List_of_U.S._state_and_territory_flowers) lists, or the species' own article where that photo was too small or uncredited.
- **Landmarks:** each one is confirmed on Wikidata to be located in its state.
- **Image sizes:** photos load at Wikimedia's standard thumbnail sizes, which Wikimedia allows sites to link to directly.
