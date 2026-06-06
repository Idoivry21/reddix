# Social CLI Canvas Automation UI Design

## Summary

Build a local web application named Reddix that wraps `public-clis/rdt-cli` and `public-clis/twitter-cli` with a canvas-first automation workbench. Users create Reddit and X/Twitter research/export flows by dragging blocks onto a freeform canvas, connecting them, configuring block settings, running flows manually, scheduling recurring runs, and reviewing run output/history.

V1 focuses on low-risk research/export workflows across both CLIs. It should support Reddit search/browsing, X/Twitter search/feed/user lookups, optional detail reads, local filtering/transforms, and exporting structured results. Authenticated write actions such as Reddit upvote/save/comment and X/Twitter post/like/retweet/bookmark/follow are out of scope for V1 except for auth-status visibility, because they increase risk and require extra confirmation design.

References:

- `public-clis/rdt-cli`: <https://github.com/public-clis/rdt-cli>
- `public-clis/twitter-cli`: <https://github.com/public-clis/twitter-cli>

## Product Shape

The primary screen is a canvas-first workbench:

- Top bar: app name, current flow name, save status, Run Now, Schedule, Export, and per-CLI health/auth indicators.
- Left palette: draggable blocks grouped by provider, then Sources, Enrichment, Transform, Output, and Utility.
- Center canvas: freeform drag-and-drop node canvas with visible connections, selected states, pan/zoom, and fit-to-view.
- Right inspector: settings for the selected block or flow, including validation messages and command preview.
- Bottom console: generated CLI command trace, run logs, parsed output preview, and run history tabs.

The UI should feel like a practical automation tool, not a landing page. First load should open directly into the workbench with a useful starter flow: Search Reddit -> Limit/Filter -> Export JSON. A template menu should also offer an X/Twitter starter flow: Search Tweets -> Engagement Filter -> Export CSV.

## V1 Blocks

Reddit sources:

- Search Posts: wraps `rdt search <query> --compact --json` with query, optional subreddit, sort, time range, and result count.
- Browse Subreddit: wraps `rdt sub <name> --compact --json` with subreddit, sort, time range, and result count.
- Popular/All: wraps `rdt popular` or `rdt all` with sort/count where supported.

Reddit enrichment:

- Read Post: wraps `rdt read <post_id> --json` for selected posts, with optional `--expand-more`.

X/Twitter sources:

- Search Tweets: wraps `twitter search <query> --json` with query, tab/type, max count, language, from-user, since date, exclude retweets, has-links, full-text, and optional ranking filter.
- Timeline Feed: wraps `twitter feed --json` with For You or Following timeline, max count, cursor, full-text, and optional ranking filter.
- Bookmarks: wraps `twitter bookmarks --json` with max count and full-text. This block requires Twitter/X auth.
- User Tweets: wraps `twitter user-posts <handle> --json` with handle, max count, and full-text.
- List Timeline: wraps `twitter list <list_id> --json` with list ID, cursor, and full-text.

X/Twitter enrichment:

- Tweet Detail: wraps `twitter tweet <tweet_id_or_url> --json` for selected tweets, with optional full-text.
- User Profile: wraps `twitter user <handle> --json` for user metadata.
- Article: wraps `twitter article <article_id_or_url> --json` or `--markdown` for X/Twitter articles.

Transform:

- Limit: caps result count.
- Filter Text: filters by include/exclude text against normalized text, title, body, community, author, and URL fields when present.
- Engagement Filter: filters Reddit posts or tweets by platform-appropriate score fields such as score, comments, likes, retweets, replies, bookmarks, or views when present.
- Sort Local: sorts parsed rows by score, comments/replies, likes, retweets, created time, platform, community, or author when present.
- Merge Streams: combines compatible arrays from Reddit and X/Twitter sources into a single normalized social-item stream.

Output:

- Export JSON: writes normalized results to a local JSON file.
- Export CSV: writes normalized results to a local CSV file.
- Export Markdown: writes a human-readable research digest grouped by platform/source.

Utility:

- Note: canvas-only annotation block.

Each block has typed input/output ports. Reddit source blocks emit arrays of normalized social items with Reddit raw payloads attached. X/Twitter source blocks emit arrays of normalized social items with Twitter raw payloads attached. Detail/enrichment blocks emit enriched items or detail objects. Transform blocks accept and emit compatible arrays. Output blocks accept arrays or objects and produce files/run artifacts.

## Execution Model

The app should run locally and invoke the installed `rdt` and `twitter` binaries through a backend process wrapper. The backend is responsible for:

- Checking whether each configured CLI is available and reporting actionable setup errors per provider.
- Running only allowlisted CLI commands generated from block settings.
- Always requesting machine-readable output with `--json`; use `--compact` for CLI commands that support it when full fields are not required.
- Parsing structured output envelopes and reading payloads from `.data` when the CLI uses that contract.
- Capturing stdout, stderr, exit code, start/end timestamps, and generated command arguments for each run step.
- Normalizing common social fields so downstream filters and exports do not depend on every CLI command returning identical payload shapes.

Flows are directed acyclic graphs for V1. The canvas may be freeform, but execution follows topological order from source blocks to output blocks. If a user creates multiple source branches, each branch runs independently and merges only when connected into a transform/output block that accepts multiple inputs. Reddit and X/Twitter branches can coexist in one flow only after provider-specific blocks normalize their outputs to the shared social-item shape.

The normalized social item should include platform, source block ID, stable item ID, URL, author, community or list when present, text/title/body fields, created timestamp, engagement counts, media/link metadata when present, and the original raw payload.

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

- Missing CLI: show provider-specific install guidance and prevent runs for flows that require that provider.
- Auth missing: show a status warning only for blocks that require auth. Reddit public read blocks should usually work without auth. X/Twitter blocks may need cookies or `TWITTER_AUTH_TOKEN` and `TWITTER_CT0`, depending on command and account access.
- Command failure: show step-level stderr, exit code, and generated command arguments.
- Invalid graph: block Run until required settings are filled, output blocks are reachable, and there are no cycles.
- Parse failure: show raw command output in the console and mark the step failed.
- Rate-limit/auth/platform failure: surface structured error codes when available, including Twitter/X `not_authenticated`, `rate_limited`, `not_found`, `invalid_input`, and `api_error`.
- Schedule failure: preserve the run record and show the latest failure on the schedule card.

No shell strings should be executed. Commands must be spawned with argument arrays from allowlisted block definitions.

## Technical Direction

Use a React + Vite + TypeScript frontend because the repo is empty and the requested surface is a complex interactive web app. Use a small local Node backend in the same project to run configured social CLIs, provide flow/run APIs, and manage local schedules.

Frontend libraries:

- React Flow for the canvas and drag/drop node graph.
- A lightweight component/style system built in the repo.
- Local state for active canvas interaction, backed by API persistence for flows and runs.

Backend responsibilities:

- REST endpoints for health, flows, runs, schedules, and exports.
- Provider registry for supported CLIs, command builders, auth/health checks, and output normalizers.
- JSON file persistence under a local app data directory.
- In-memory scheduler restored from persisted flow schedule settings at startup.

## Acceptance Criteria

- The app opens to a canvas-first workbench with a starter flow.
- The block palette includes both Reddit and X/Twitter provider sections.
- Users can drag blocks from the palette to the canvas, connect them, select them, and edit settings in the inspector.
- The Run Now action validates the graph, executes generated CLI commands through the backend, and streams or refreshes step logs in the console.
- Parsed results appear in an output preview after a successful run.
- JSON, CSV, and Markdown export blocks write local output artifacts and display their paths.
- Users can save a flow, reload the app, and see the same nodes, edges, settings, and positions.
- Users can configure a schedule, see the next-run time, pause/resume it, and see scheduled run history while the backend remains running.
- Missing CLIs, invalid settings, command failures, parse failures, provider auth failures, rate limits, and graph cycles produce clear UI errors.

## Test Strategy

- Unit-test command builders to ensure each block maps to the correct provider-specific argument array and never shell-concatenates user input.
- Unit-test graph validation for missing required fields, disconnected output blocks, invalid port types, and cycles.
- Unit-test normalization/filter/export helpers with representative rdt and Twitter/X structured payloads.
- Backend integration-test run execution with fake `rdt` and `twitter` binaries or injected executors so tests do not require Reddit, Twitter/X, or network access.
- Frontend component-test or browser-test core interactions: drag provider-specific blocks, connect nodes, edit inspector settings, run starter flows, view logs/results, configure schedule.
- Manual browser QA at desktop and mobile-ish widths to verify layout, no clipped text, and usable canvas/inspector/console behavior.

## Assumptions

- V1 is a local tool, not a hosted multi-user app.
- The user will install `rdt-cli` and `twitter-cli` separately; the app detects and reports missing CLIs instead of bundling them.
- V1 excludes authenticated write actions and posting/commenting across both Reddit and X/Twitter.
- Schedules run only while the backend process is alive.
- Local JSON persistence is sufficient for the first version.
- The approved layout is canvas-first, not kanban or linear pipeline.
