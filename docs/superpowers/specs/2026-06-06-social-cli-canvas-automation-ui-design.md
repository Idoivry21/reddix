# Social CLI Canvas Automation — Design Spec (v2.1)

> **Working name:** `Reddix`. Flagged as an open question — the name reads as Reddit-only, but V1 is explicitly dual-provider (Reddit **and** X/Twitter) with near-parity. See [Open Questions](#open-questions).
>
> **Implementation status (2026-06-07):** the shipped app uses a bespoke DOM/SVG canvas in `src/components/Canvas.tsx`, not React Flow / `@xyflow/react`. The current starter flow is **Weekly market digest** with Reddit and X/Twitter branches, and HTML reports have shipped as a P1 output.

## Summary

Build a local web application that wraps `public-clis/rdt-cli` and `public-clis/twitter-cli` in a canvas-first automation workbench. Users build Reddit and X/Twitter research/export flows by dragging blocks onto a freeform canvas, connecting them, configuring block settings, running flows manually or on a schedule, and reviewing run output and history.

V1 is a **local, single-user research/export tool**. It covers Reddit search/browsing, X/Twitter search/feed/user lookups, optional detail reads, local filtering/transforms, and structured export. Authenticated write actions (Reddit upvote/save/comment; X/Twitter post/like/retweet/bookmark/follow) are **out of scope except for read-only auth-status visibility** — they raise risk and need a separate confirmation design.

References:
- `public-clis/rdt-cli`: <https://github.com/public-clis/rdt-cli>
- `public-clis/twitter-cli`: <https://github.com/public-clis/twitter-cli>

## Goals

These are the outcomes V1 is judged against, not feature outputs:

1. A user can go from empty canvas to a working export in under five minutes using a starter flow, with no manual command typing.
2. Every block maps to a fixed, allowlisted argument array; **no user input is ever shell-concatenated.**
3. A saved flow reloads byte-for-byte (nodes, edges, positions, settings, schedule) after an app restart.
4. Failures are concrete and actionable: the user can always see the exact command args, exit code, and stderr for a failed step.
5. The app never weakens, disables, or out-runs the underlying CLIs' built-in rate-limiting and never persists or prints auth secrets.

## Non-Goals (V1)

Stated explicitly to prevent scope creep:

- **Authenticated write actions** (post/comment/vote/like/retweet/bookmark/follow). Higher risk; needs dedicated confirmation UX. Auth *status* is shown; actions are not.
- **Hosted / multi-user / multi-tenant operation.** V1 is a single local process.
- **A database.** Local JSON persistence only (see [Data Model](#data-model)).
- **Bundling the CLIs.** The app detects and reports missing binaries; the user installs them.
- **Cross-account or account-management features** (multiple Twitter accounts, login flows inside the UI). Auth is delegated to the CLIs.
- **Deep auto-pagination of feeds/lists.** V1 fetches a single page per source (bounded by the block's max count). Cursor-driven multi-page fetch is a P1.
- **Full mobile authoring.** A pan/zoom node editor is not a realistic touch target for V1; mobile is monitor/read-only. See [Open Questions](#open-questions).

## Product Shape

The primary (and only) screen is a canvas-first workbench:

- **Top bar:** app name, current flow name, save status, Run Now, Schedule, Export, and per-CLI health/auth indicators.
- **Left palette:** draggable blocks grouped by provider, then Sources, Enrichment, Transform, Output, Utility. Includes a palette search/filter box.
- **Center canvas:** freeform drag-and-drop node canvas with visible connections, selection states, pan/zoom, and fit-to-view controls.
- **Right inspector:** settings for the selected block or flow, with inline validation messages and a live **command preview** (secrets redacted).
- **Bottom console:** generated CLI command trace, run logs, parsed output preview, and run-history tabs.

The UI should read as a practical automation tool, not a landing page. First load opens directly into the workbench with the **Weekly market digest** starter flow: Reddit and X/Twitter sources feed filters, merge, sort, limit, then export CSV and JSON. A template menu can still add more focused provider-specific starters later.

### Canvas interactions (table stakes — do not defer)

A node editor is unusable without these, so they are P0, not polish:

- Multi-select (drag-box and shift-click), delete selected, duplicate (Ctrl/Cmd-D), copy/paste.
- **Undo/redo** for add/move/connect/delete/edit (Ctrl/Cmd-Z / Shift-Z).
- Keyboard shortcuts for run, save, delete, fit-to-view.
- Connection validation on drag: incompatible ports reject the edge with a reason.

Implementation note: current code supports add/select/drag/connect, duplicate/delete, pan/zoom, fit-to-view, keyboard palette focus, and mobile read-only enforcement. Multi-select, copy/paste, undo/redo, and minimap remain design targets rather than current shipped behavior.

### States to design beyond first load

- **Empty:** no saved flows (offer templates); empty run history; empty output preview.
- **Loading:** flow loading, run in progress (per-step spinners), export writing.
- **Error:** missing CLI, auth warning, invalid graph, step failure, parse failure (each defined in [Error Handling](#error-handling-and-safety)).

## V1 Blocks

Each block has typed input/output ports (see [Port types](#port-types-and-connection-rules)). Reddit source blocks emit `SocialItem[]` with the Reddit raw payload attached; X/Twitter source blocks emit `SocialItem[]` with the Twitter raw payload attached. Enrichment blocks emit enriched items or detail objects. Transform blocks accept and emit compatible arrays. Output blocks accept arrays or objects and produce file artifacts.

> **Prioritization.** Be ruthless about P0 — the tighter the must-have list, the faster V1 ships and the smaller the starter flows' surface. Tags below: **P0** = required for the two starter flows + core value; **P1** = fast follow.

**Reddit sources**
- **Search Posts** *(P0)* — wraps `rdt search <query> --compact --json`; query, optional subreddit, sort, time range, result count.
- **Browse Subreddit** *(P1)* — wraps `rdt sub <name> --compact --json`; subreddit, sort, time range, count.
- **Popular / All** *(P1)* — wraps `rdt popular` / `rdt all` with sort/count where supported.

**Reddit enrichment**
- **Read Post** *(P1)* — wraps `rdt read <post_id> --json` for selected posts, optional `--expand-more`.

**X/Twitter sources**
- **Search Tweets** *(P0)* — wraps `twitter search <query> --json`; query, tab/type, max count, language, from-user, since date, exclude retweets, has-links, full-text, optional ranking filter.
- **Timeline Feed** *(P1)* — wraps `twitter feed --json`; For You / Following, max count, cursor, full-text, optional ranking filter.
- **Bookmarks** *(P1, requires auth)* — wraps `twitter bookmarks --json`; max count, full-text.
- **User Tweets** *(P1)* — wraps `twitter user-posts <handle> --json`; handle, max count, full-text.
- **List Timeline** *(P1)* — wraps `twitter list <list_id> --json`; list ID, cursor, full-text.

**X/Twitter enrichment**
- **Tweet Detail** *(P1)* — wraps `twitter tweet <tweet_id_or_url> --json`, optional full-text.
- **User Profile** *(P1)* — wraps `twitter user <handle> --json`.
- **Article** *(P1)* — wraps `twitter article <id_or_url> --json` or `--markdown`.

**Transform**
- **Limit** *(P0)* — caps result count.
- **Filter Text** *(P0)* — include/exclude against normalized text, title, body, community, author, and URL fields when present.
- **Engagement Filter** *(P0)* — filters by platform-appropriate score fields (score, comments, likes, retweets, replies, bookmarks, views) when present.
- **Sort Local** *(P1)* — sorts by score, comments/replies, likes, retweets, created time, platform, community, or author when present.
- **Merge Streams** *(P1)* — combines compatible `SocialItem[]` from Reddit and X/Twitter sources into one normalized stream.

**Output**
- **Export JSON** *(P0)* — writes normalized results to a local JSON file.
- **Export CSV** *(P0)* — writes normalized results to a local CSV file.
- **Export Markdown** *(P1)* — writes a human-readable digest grouped by platform/source.
- **Export HTML Report** *(P1, shipped)* — writes a styled, self-contained browser-readable report and exposes an in-app "Open report" link.

**Utility**
- **Note** *(P1)* — canvas-only annotation.

## Data Model

This section is new and intentionally concrete: the transforms, Merge Streams, and all three exporters depend on a *single agreed shape*. Specifying it up front removes the largest source of "every block returns something slightly different" bugs.

### Normalized `SocialItem`

The normalizer maps each provider command's payload onto this shape. Fields absent for a platform are `null` (never invented).

| Field | Type | Notes |
|---|---|---|
| `platform` | `"reddit" \| "twitter"` | |
| `sourceBlockId` | `string` | Which block produced it (provenance for Merge/Sort). |
| `id` | `string` | Stable per-platform item ID. |
| `url` | `string \| null` | Canonical permalink. |
| `author` | `string \| null` | Handle / username. |
| `community` | `string \| null` | Subreddit, or list/source context for Twitter. |
| `title` | `string \| null` | Reddit title; null for most tweets. |
| `body` | `string \| null` | Self-text / tweet text. |
| `text` | `string` | Normalized searchable text (title + body collapsed) used by Filter Text. |
| `createdAt` | `string` (ISO 8601) | UTC. |
| `engagement` | `object` | `{ score?, comments?, replies?, likes?, retweets?, bookmarks?, views? }`, each `number \| null`. |
| `media` | `array` | `{ type, url }[]` when present. |
| `links` | `string[]` | Outbound links when present. |
| `raw` | `object` | Original provider payload, untouched. |

> **Mapping is a deliverable.** Each provider command needs a documented field-mapping table from its `--json` payload to `SocialItem`. These tables are the contract the normalizer is tested against (golden payloads).

### Port types and connection rules

A small, enumerated type set keeps connection validation simple and testable:

- `SocialItem[]` — output of sources and transforms; input of transforms and outputs.
- `DetailObject` — output of enrichment detail blocks (Tweet Detail, User Profile, Article, Read Post).
- `FileArtifact` — output of export blocks.
- `Any` — Note and other utility ports.

Connection rules: an edge is valid only if the source port type is assignable to the target port type. `SocialItem[] → SocialItem[]` is the common case; `DetailObject` may feed an enrichment-aware output but not a `SocialItem[]`-only transform. The UI rejects invalid edges at drag time with a stated reason.

### Persisted shapes (local JSON)

Every persisted record carries a `schemaVersion` so the format can migrate without a database:

- **Flow** — `{ schemaVersion, id, name, nodes, edges, nodePositions, blockSettings, schedule, createdAt, updatedAt }`.
- **Run** — `{ schemaVersion, id, flowId, status, startedAt, endedAt, steps: [{ blockId, status, argv, exitCode, stdoutSummary, stderr, startedAt, endedAt }], outputFiles, error }`.
- **Preferences** — `{ schemaVersion, defaultExportDir, selectedFlowId }`.

A small `migrate(record)` step runs on load. Run history is **capped** (keep the last N runs per flow, prune by age) so the JSON store stays bounded.

## Execution Model

The app runs locally and invokes the installed `rdt` and `twitter` binaries through a backend process wrapper. The backend:

- Detects whether each configured CLI is available and reports provider-specific setup errors.
- Runs only allowlisted commands generated from block settings, **spawned with argument arrays** — never shell strings.
- Always requests machine-readable output with `--json`; uses `--compact` where supported when full fields aren't needed.
- Parses structured envelopes, reading payloads from `.data` when the CLI uses that contract.
- Captures stdout, stderr, exit code, start/end timestamps, and the generated argv for every step (argv redacted of any secret before storage/display).
- Normalizes common social fields into `SocialItem` so downstream blocks don't depend on identical payload shapes.

**Graphs are DAGs.** The canvas is freeform, but execution follows topological order from sources to outputs. Independent source branches run independently and only merge where connected into a multi-input transform/output. Reddit and X/Twitter branches may coexist in one flow only after provider-specific blocks normalize to `SocialItem`.

**Partial failure (new — previously undefined):** the default is **continue-on-error**: a failed step marks its downstream-dependent steps `skipped` and records the failure; unrelated branches still run. A flow-level **fail-fast** toggle stops the whole run on the first failure. Either way the run record captures per-step status.

**Concurrency & overlap (new):**
- **Single-flight per flow:** if a flow is already running (manual or scheduled), a new trigger for the same flow is **skipped** and noted on the run record, not queued silently.
- **Per-provider serialization:** steps hitting the same provider run with a minimum spacing rather than in parallel bursts, so the app never multiplies request rate against Reddit/X.

**Log streaming:** the backend streams step logs to the console via **Server-Sent Events** (simple for a Node backend), with polling as a fallback. "Streams or refreshes" is now specified, not left to interpretation.

**Pagination:** V1 fetches one page per source bounded by the block's max count. Cursor-driven multi-page fetch (Timeline Feed, List Timeline) is a P1; the cursor field is exposed now so the data model doesn't change later.

## Auth, Secrets, and Rate-Limit Safety

This consolidates and hardens what was scattered before. It reflects how the CLIs actually behave.

**Reddit auth is delegated to `rdt-cli`.** rdt-cli manages its own cookie store (`rdt login`, refreshed from the browser; cookies valid ~7 days) under its own config directory. **The app does not store, copy, or print Reddit cookies.** It only reads and surfaces auth *status* (e.g., logged-in / expired) and points the user to `rdt login` when expired. Most public read blocks work without auth.

**X/Twitter auth is via environment.** `twitter-cli` uses `TWITTER_AUTH_TOKEN` and `TWITTER_CT0` (or browser cookies). The app reads these from the environment, an OS keychain, or a single git-ignored secrets file with `0600` permissions. These values are **never written to flow JSON, run records, or the command trace**, and are **redacted** anywhere a command would otherwise display them. Only blocks that need auth (e.g., Bookmarks) show an auth warning.

**Respect the CLIs' own throttling — do not fight it.** `rdt-cli` already applies exponential backoff and ~1s Gaussian jitter to mimic natural browsing; the app must not disable or undercut this. On top of it the app adds: a **minimum schedule interval** (so "every 15 minutes" can't be set absurdly low), schedule **jitter**, per-provider serialization, and its own exponential backoff with jitter when a step returns `rate_limited`. The goal is explicitly to protect the user's accounts from being flagged.

**No shell strings, ever.** Commands are built as argv arrays from allowlisted block definitions. User input is a value in the array, never interpolated into a string.

## Scheduling And Persistence

Flows can be saved and run manually or on a schedule. **V1 schedules are local-only and active only while the backend is running.**

Persist locally (see [Persisted shapes](#persisted-shapes-local-json)): saved flows; run records; user preferences. Use simple local JSON, `schemaVersion`-tagged for later migration. No database.

Scheduling supports:
- Disabled / manual-only.
- Interval schedules (e.g., every 15 min, hourly, daily, weekly), subject to a **minimum interval** and applied **jitter**.
- A visible next-run timestamp.
- Manual pause/resume.
- **Overlap policy:** if the previous scheduled run is still in flight, skip this tick and record it (single-flight, per Execution Model).

**Export file management (new):** export filenames are templated with the run timestamp (e.g., `flowname-YYYYMMDD-HHMMSS.json`) so repeated scheduled runs don't silently overwrite each other; the default directory comes from preferences and the resolved path is shown after each run.

## Error Handling And Safety

Make failures concrete:

- **Missing CLI:** provider-specific install guidance; block runs for flows that require that provider.
- **Auth missing:** status warning only for blocks that require auth. Reddit public reads usually work without auth; X/Twitter may need cookies or `TWITTER_AUTH_TOKEN` / `TWITTER_CT0`.
- **Command failure:** step-level stderr, exit code, and (redacted) generated argv.
- **Invalid graph:** block Run until required settings are filled, an output block is reachable, and there are no cycles.
- **Parse failure:** show raw command output in the console and mark the step failed.
- **Structured platform errors:** surface codes when available, including X/Twitter `not_authenticated`, `rate_limited`, `not_found`, `invalid_input`, `api_error`. `rate_limited` triggers backoff (above) rather than an immediate hard fail.
- **Schedule failure:** preserve the run record and show the latest failure on the schedule card.

## Technical Direction

A React + Vite + TypeScript frontend (the repo is empty and the surface is a complex interactive web app), with a small local Node backend in the same project to run the CLIs, expose flow/run APIs, and manage local schedules.

**Frontend**
- Bespoke DOM/SVG canvas for the node graph and drag-drop (no React Flow / `@xyflow` dependency).
- A lightweight in-repo component/style system.
- Local state for active canvas interaction, backed by API persistence for flows and runs.

**Backend**
- REST endpoints for health, flows, runs, schedules, exports; **SSE** for live run logs.
- A provider registry: supported CLIs, command builders, auth/health checks, output normalizers.
- JSON file persistence in a local app-data directory, `schemaVersion`-tagged with a `migrate` step.
- In-memory scheduler restored from persisted schedules at startup.
- **CLI compatibility guard:** pin/verify each CLI's expected command surface against its `--help` output (a golden test), so a CLI update that drops or renames a flag fails loudly in tests instead of silently at runtime.

## Acceptance Criteria

Written so each is independently testable.

- [ ] App opens to the canvas workbench with the dual-provider Weekly market digest starter flow pre-loaded.
- [ ] Palette shows both Reddit and X/Twitter provider sections and supports search/filter.
- [ ] User can drag a block to the canvas, connect it, select it, and edit settings in the inspector.
- [ ] Connecting incompatible ports is rejected with a stated reason.
- [ ] Undo/redo, multi-select, delete, and duplicate work on canvas nodes.
- [ ] Run Now validates the graph, executes generated commands via the backend, and streams step logs to the console.
- [ ] Parsed results appear in the output preview after a successful run.
- [ ] JSON, CSV, Markdown, and HTML report exports write local artifacts and display their resolved paths; repeated runs do not overwrite each other.
- [ ] Save a flow, restart the app, and the same nodes, edges, settings, and positions reload.
- [ ] Configure a schedule, see the next-run time, pause/resume, and view scheduled run history while the backend runs.
- [ ] Missing CLIs, invalid settings, command failures, parse failures, auth failures, rate limits, and cycles each produce a clear UI error.

Given/When/Then for the higher-risk paths:

- **Secrets:** *Given* `TWITTER_AUTH_TOKEN` is set, *when* a Twitter step runs, *then* the token appears in neither the command preview, the run record, nor any log.
- **Overlap:** *Given* a scheduled run is in progress, *when* the next tick fires, *then* it is skipped and recorded, not run concurrently.
- **Partial failure:** *Given* a two-branch flow where one source fails, *when* the run completes, *then* the failed branch's dependents are `skipped` and the healthy branch still produces output.

## Quality Bar

(For a local single-user tool, growth metrics like adoption rate don't apply; "done" is defined by the bar below plus passing acceptance criteria.)

- All command builders, graph validation, and normalize/filter/export helpers are unit-tested.
- No secret ever reaches a log, run record, or the rendered command preview (verified by test).
- The app never issues requests faster than each CLI's own throttling allows.
- A saved flow round-trips losslessly across restart and a schema migration.

## Test Strategy

- **Command builders:** unit-test that each block maps to the correct provider-specific argv and never shell-concatenates user input.
- **Graph validation:** unit-test missing required fields, disconnected/unreachable output blocks, invalid port-type connections, and cycles.
- **Normalization / filter / export:** unit-test against representative `rdt` and X/Twitter golden payloads, including missing-field cases.
- **Secrets:** test that auth tokens are absent from argv-as-displayed, run records, and logs (redaction).
- **Schema migration:** test that a `schemaVersion` n−1 flow/run loads and upgrades.
- **Concurrency & backoff:** test single-flight skip on overlap and exponential backoff on a simulated `rate_limited`.
- **CLI compatibility:** golden test asserting expected flags exist in each CLI's `--help`.
- **Backend run execution:** integration-test with fake `rdt`/`twitter` binaries or injected executors — no Reddit, X/Twitter, or network access required.
- **Frontend interactions:** component- or browser-test the core loop — drag provider blocks, connect, edit inspector, run a starter flow, view logs/results, configure a schedule, undo/redo.
- **Manual QA:** desktop authoring; verify no clipped text and usable canvas/inspector/console. Mobile QA targets the monitor/read-only experience (see Open Questions), not full authoring.

## Open Questions

Genuinely unresolved; tagged with who should weigh in.

- **Naming** *(product)* — `Reddix` reads as Reddit-only. Options: keep it and accept the mismatch, or pick a provider-neutral name (e.g., a "social CLI workbench" identity). Decide before any user-facing branding lands.
- **Mobile scope** *(resolved)* — mobile is read-only run/monitor. Canvas editing is desktop-only for V1.
- **Auto-pagination depth** *(eng)* — when cursors are added (P1), what's the max pages/items a single run may fetch, to bound request volume?
- **Flow import/export** *(product)* — should a flow be exportable/importable as a JSON file in V1 for sharing/backup, or is that P1? (Cheap given the persisted shape already exists.)
- **rdt index cache** *(eng)* — `rdt-cli` caches the latest listing for `rdt show <N>`. Confirm the wrapper always reads via stable IDs (`rdt read <post_id>`) and never relies on positional `show`, which is order-sensitive across runs.
- **Multiple X/Twitter accounts** *(product)* — confirmed out of scope for V1, but note here so it isn't reintroduced casually.

## Assumptions

- V1 is a local tool, not a hosted multi-user app.
- The user installs `rdt-cli` and `twitter-cli` separately; the app detects and reports missing CLIs rather than bundling them.
- V1 excludes authenticated write actions and posting/commenting on both platforms.
- Schedules run only while the backend process is alive.
- Local JSON persistence (schema-versioned) is sufficient for the first version.
- The approved layout is canvas-first, not kanban or linear pipeline.
