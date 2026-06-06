# rdt-cli Canvas Automation UI Design

## Summary

Build a local web application named Reddix that wraps `public-clis/rdt-cli` with a canvas-first automation workbench. Users create Reddit research/export flows by dragging blocks onto a freeform canvas, connecting them, configuring block settings, running flows manually, scheduling recurring runs, and reviewing run output/history.

V1 focuses on low-risk research/export workflows. It should support Reddit search and browsing, optional post reading, local filtering/transforms, and exporting structured results. Authenticated account actions such as upvote, save, subscribe, and comment are out of scope for V1 except for auth-status visibility, because they increase risk and require extra confirmation design.

## Product Shape

The primary screen is a canvas-first workbench:

- Top bar: app name, current flow name, save status, Run Now, Schedule, Export, and auth/status indicator.
- Left palette: draggable blocks grouped as Sources, Enrichment, Transform, Output, and Utility.
- Center canvas: freeform drag-and-drop node canvas with visible connections, selected states, pan/zoom, and fit-to-view.
- Right inspector: settings for the selected block or flow, including validation messages and command preview.
- Bottom console: generated `rdt` command trace, run logs, parsed output preview, and run history tabs.

The UI should feel like a practical automation tool, not a landing page. First load should open directly into the workbench with a useful starter flow: Search Reddit -> Limit/Filter -> Export JSON.

## V1 Blocks

Sources:

- Search Posts: wraps `rdt search <query> --compact --json` with query, optional subreddit, sort, time range, and result count.
- Browse Subreddit: wraps `rdt sub <name> --compact --json` with subreddit, sort, time range, and result count.
- Popular/All: wraps `rdt popular` or `rdt all` with sort/count where supported.

Enrichment:

- Read Post: wraps `rdt read <post_id> --json` for selected posts, with optional `--expand-more`.

Transform:

- Limit: caps result count.
- Filter Text: filters by include/exclude text against title/selftext/subreddit/author fields when present.
- Sort Local: sorts parsed rows by score, comments, created time, or subreddit when present.

Output:

- Export JSON: writes normalized results to a local JSON file.
- Export CSV: writes normalized results to a local CSV file.

Utility:

- Note: canvas-only annotation block.

Each block has typed input/output ports. Source blocks emit arrays of posts. Read Post emits a post-detail object or enriched post rows. Transform blocks accept and emit arrays. Output blocks accept arrays or objects and produce files/run artifacts.

## Execution Model

The app should run locally and invoke the installed `rdt` binary through a backend process wrapper. The backend is responsible for:

- Checking whether `rdt` is available and reporting an actionable setup error if not.
- Running only allowlisted rdt commands generated from block settings.
- Always requesting machine-readable output with `--json` and using `--compact` for listing commands unless a block explicitly needs full fields.
- Parsing the rdt envelope and reading payloads from `.data`.
- Capturing stdout, stderr, exit code, start/end timestamps, and generated command arguments for each run step.
- Normalizing common post fields so downstream filters and exports do not depend on every rdt command returning identical payload shapes.

Flows are directed acyclic graphs for V1. The canvas may be freeform, but execution follows topological order from source blocks to output blocks. If a user creates multiple source branches, each branch runs independently and merges only when connected into a transform/output block that accepts multiple inputs.

## Scheduling And Persistence

Users can save flows and run them manually or on a schedule. V1 schedules are local-only and active only while the app backend is running.

Persist locally:

- Saved flows, including nodes, edges, positions, block settings, created/updated timestamps, and schedule settings.
- Run records, including status, per-step logs, parsed output summary, output file paths, and errors.
- User preferences such as default export directory and selected flow.

Use simple local JSON persistence for V1 rather than a database. The data model should be easy to migrate later if scheduling/history grows.

Scheduling supports:

- Disabled/manual-only.
- Interval schedules such as every 15 minutes, hourly, daily, or weekly.
- A visible next-run timestamp.
- Manual pause/resume.

## Error Handling And Safety

The UI should make failures concrete:

- Missing `rdt`: show install guidance and prevent runs.
- Auth missing: show a status warning only for blocks that require auth; V1 research/export blocks should usually work without auth.
- Command failure: show step-level stderr, exit code, and generated command arguments.
- Invalid graph: block Run until required settings are filled, output blocks are reachable, and there are no cycles.
- Parse failure: show raw command output in the console and mark the step failed.
- Schedule failure: preserve the run record and show the latest failure on the schedule card.

No shell strings should be executed. Commands must be spawned with argument arrays from allowlisted block definitions.

## Technical Direction

Use a React + Vite + TypeScript frontend because the repo is empty and the requested surface is a complex interactive web app. Use a small local Node backend in the same project to run `rdt`, provide flow/run APIs, and manage local schedules.

Frontend libraries:

- React Flow for the canvas and drag/drop node graph.
- A lightweight component/style system built in the repo.
- Local state for active canvas interaction, backed by API persistence for flows and runs.

Backend responsibilities:

- REST endpoints for health, flows, runs, schedules, and exports.
- rdt command builder and executor.
- JSON file persistence under a local app data directory.
- In-memory scheduler restored from persisted flow schedule settings at startup.

## Acceptance Criteria

- The app opens to a canvas-first workbench with a starter flow.
- Users can drag blocks from the palette to the canvas, connect them, select them, and edit settings in the inspector.
- The Run Now action validates the graph, executes generated rdt commands through the backend, and streams or refreshes step logs in the console.
- Parsed results appear in an output preview after a successful run.
- JSON and CSV export blocks write local output artifacts and display their paths.
- Users can save a flow, reload the app, and see the same nodes, edges, settings, and positions.
- Users can configure a schedule, see the next-run time, pause/resume it, and see scheduled run history while the backend remains running.
- Missing `rdt`, invalid settings, command failures, parse failures, and graph cycles produce clear UI errors.

## Test Strategy

- Unit-test command builders to ensure each block maps to the correct `rdt` argument array and never shell-concatenates user input.
- Unit-test graph validation for missing required fields, disconnected output blocks, invalid port types, and cycles.
- Unit-test normalization/filter/export helpers with representative rdt envelope payloads.
- Backend integration-test run execution with a fake `rdt` binary or injected executor so tests do not require Reddit/network access.
- Frontend component-test or browser-test core interactions: drag block, connect nodes, edit inspector settings, run starter flow, view logs/results, configure schedule.
- Manual browser QA at desktop and mobile-ish widths to verify layout, no clipped text, and usable canvas/inspector/console behavior.

## Assumptions

- V1 is a local tool, not a hosted multi-user app.
- The user will install `rdt-cli` separately; the app detects and reports missing CLI instead of bundling it.
- V1 excludes authenticated write actions and comment posting.
- Schedules run only while the backend process is alive.
- Local JSON persistence is sufficient for the first version.
- The approved layout is canvas-first, not kanban or linear pipeline.
