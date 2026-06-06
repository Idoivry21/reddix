---
_harness_template: "Plans.md.template"
_harness_version: "4.3.3"
---

# Plans.md - Task Tracking

> **Project**: reddix
> **Last updated**: 2026-06-06
> **Updated by**: Claude Code

> **Format note**: Tasks use the Harness **table format** (`| Task | Description | DoD | Depends | Status |`)
> required by `harness sprint-contract` / `harness-loop`. The earlier bullet-list format is
> only parsed by the marker-counting hooks, not the contract generator. Keep tasks in the tables
> below; the **Task Details** section preserves the file:line problem/fix analysis for workers.

---

> **Initiative**: improve UI/UX + perf, make production-ready.
> Backed by 3 parallel subagent reviews (UX, perf/architecture, security/prod) — `team_validation_mode: subagent`. All findings verified against source. Baseline at plan time: 39 tests pass, `tsc -b` clean, ~2900 LOC.

## Tasks

### Phase 1 — Security & correctness (P0, blocks "production")

| Task | Description | DoD | Depends | Status |
|------|-------------|-----|---------|--------|
| T101 | Wire redactSecrets into the run pipeline so auth tokens in CLI stderr/stdout never persist or stream | test proves a token in fake CLI stderr never appears in RunRecord, SSE payload, or persisted JSON; invariant-2 test added | - | cc:done [54f08eb] |
| T102 | Restrict CORS from wide-open to the local Vite origin to stop DNS-rebind/CSRF against localhost | CORS allows only the Vite origin (env-config default); test rejects a foreign Origin | T101 | cc:done [fd0474c] |
| T103 | Security fix: validate flowId before path join to block directory escape and reject unsafe separators | storage rejects or normalizes ids with slash or dot-dot; test covers malicious id payloads | - | cc:done [0c9fc65] |
| T104 | Validate API request bodies with zod schemas at the flow PUT and run POST boundaries | zod schemas for flow PUT + run POST; malformed body returns 400 with a safe message; tests cover valid and malformed | T103 | cc:done [f6a70ba] |
| T105 | Add Express error middleware, process handlers, and graceful shutdown | error middleware returns safe JSON without internals; uncaughtException/unhandledRejection/SIGTERM handlers log and exit cleanly; SIGTERM closes SSE and server; test for middleware path | - | cc:done [cd0f1b1] |
| T106 | Contain export artifact paths so a flow cannot write outside the data dir | writeArtifact resolves under dataDir/artifacts and rejects traversal (`../`); test covers malicious export path | T103 | cc:done [b299442] |

### Phase 2 — Backend robustness & throttling (P1)

| Task | Description | DoD | Depends | Status |
|------|-------------|-----|---------|--------|
| T201 | Add SSE heartbeat, guarded per-client broadcast writes, and a connection cap | periodic ping comment; each write try/caught and failed client dropped; max-connection cap; client auto-reconnect; test guarded-write drop | T105 | cc:done [9c4efd3] |
| T202 | Serialize per-flow run-record writes so concurrent appends never drop records | per-flow async mutex/queue serializes writes; test proves concurrent appends keep all records | T103 | cc:done [5144fe3] |
| T203 | Cap executor stdout/stderr buffering to avoid OOM on a runaway CLI | configurable max-bytes; over-cap truncates and marks the step failed with a clear reason; test covers the cap | - | cc:done [c790211] |
| T204 | Make the scheduler actually fire due flows with min-interval, jitter, single-flight, and per-provider spacing | timer fires due flows respecting 15-min min interval plus jitter and single-flight; per-provider spacing applied; overlap becomes a recorded skip; tests for due-calc, single-flight, spacing | T202 | cc:done [b3832f2] |
| T205 | Rate-limit the subprocess-spawning /runs route and validate env at startup | per-flow run rate limit; startup validates PORT and REDDIX_DATA_DIR and logs auth-token presence never values; tests for limiter and env validation | T104 | cc:done [23714e8] |

### Phase 3 — UI/UX correctness (P0/P1 — explicit ask)

| Task | Description | DoD | Depends | Status |
|------|-------------|-----|---------|--------|
| T301 | Make the Inspector read the real selected node and use controlled inputs that persist edits | Inspector receives the real node, renders data.blockType spec fields, and edits write back to blockSettings via the shared model; test edits propagate | - | cc:done [34b8ce3] |
| T302 | Render ConsolePanel detail from the live RunRecord instead of hardcoded fake output | command-trace and history render the live RunRecord with redacted displayArgv; no static data remains; test renders from a record fixture | T301 | cc:done [8d81748] |
| T303 | Make BlockNode show real per-node run status instead of always-green | status icon and color reflect data.status idle/pending/running/success/error with a non-color cue for WCAG 1.4.1; seed is idle; test per status | - | cc:done [36a0358] |
| T304 | Surface real provider health in the TopBar from the /health endpoint | health comes from /health; missing or unhealthy CLI shown distinctly; test with healthy and missing fixtures | - | cc:done [73abab3] |
| T305 | Surface run error and warning states distinctly and announce run status via aria-live | distinct error and warning state class; aria-live region announces run start, success, and failure; test asserts error state and announcement | T302 | cc:done [32c2bbb] |

### Phase 4 — Accessibility & UX polish (P1/P2)

| Task | Description | DoD | Depends | Status |
|------|-------------|-----|---------|--------|
| T401 | Make block authoring keyboard-accessible (palette click-to-add and Enter/Space) | click-to-add plus Enter/Space add; role=button and tabIndex on palette items; e2e adds a block via keyboard | T301 | cc:done [8798cf1] |
| T402 | Add visible focus-visible rings everywhere and wire or remove the Cmd-K affordance | global focus-visible rings on interactive elements and canvas; implement Cmd-K palette focus/search or remove the badge; manual keyboard pass documented | - | cc:done [1e684e8] |
| T403 | Replace fake tabs with real WAI-ARIA tabs and arrow-key roving | WAI-ARIA tabs pattern with arrow-key roving; test roles and selection | - | cc:done [6e5a575] |
| T404 | Add empty/first-run states, stable list keys, and a log cap | empty states for canvas/results/console; stable unique keys; logs capped at about 200; tests for cap and key stability | - | cc:done [24189fb] |
| T405 | Enforce mobile read-only so the breakpoint disables authoring actions | below the breakpoint disable drag/add/run/edit as monitor-only; existing chromium-mobile-readonly e2e asserts enforcement | - | cc:done [260f3c9] |

### Phase 5 — Frontend performance (P1/P2)

| Task | Description | DoD | Depends | Status |
|------|-------------|-----|---------|--------|
| T501 | Narrow recompute/re-render scope so drag and SSE steps stop rebuilding wide state | recompute gated on selected node id and settings not array identity; nodeTypeMap memoized per run; test or profiling note shows reduced recompute | T301 | cc:done [17ad54a] |
| T502 | Snapshot history on drag commit only, not on every position change | snapshot on drag end or non-position commit only; test undo restores pre-drag position in one step | - | cc:done [48bfb23] |
| T503 | Add a Vite production build config with manual chunk splitting | manualChunks splits xyflow; chunk-size budget and sourcemaps set; npm run build succeeds and the chunk report is recorded | - | cc:done [46d0174] |

### Phase 6 — Production deploy & docs (P1)

| Task | Description | DoD | Depends | Status |
|------|-------------|-----|---------|--------|
| T601 | Provide a single-process production serve path with a real server build | prod serves built dist from Express or a documented two-process setup; server emits and runs reproducibly; smoke test hits the served index and /api/health | T102,T503 | cc:done [d5b4f8b] |
| T602 | Add structured request and error logging that reuses redaction | structured request and error logger that is secret-safe and reuses redaction and never logs token values | T105 | cc:done [0a2cbe8] |
| T603 | Add a Dockerfile, dockerignore, README run path, and env docs | Dockerfile and dockerignore build and run clean; README documents dev and prod run, env vars, and security invariants | T601 | cc:done [4c04b27] |
| T604 | Add E2E coverage for critical flows and wire a CI gate | e2e covers keyboard add-block, run with live steps, error surface, and mobile read-only; test:run plus test:e2e plus lint wired as a CI gate; all green | T301,T401,T601 | cc:done [3778a2d] |

---

## Task Details

> Preserved problem/fix analysis (file:line refs) from the planning reviews. Workers should read the
> relevant entry before implementing. `[P]` = parallelizable.

### T101 — Wire redactSecrets into run pipeline
- `redactSecrets` is dead code; raw CLI `stderr`/`stdoutSummary`/`error` persist to `runs/*.json` + broadcast over SSE → `TWITTER_AUTH_TOKEN`/`TWITTER_CT0` leak if a CLI echoes them. (argv already safe via `displayArgv`.)
- Build secret map from env once; redact every `stderr`/`stdoutSummary`/`error` string before it enters `RunStep`/`RunRecord`/SSE/disk (`runEngine.ts:74-78,101-102`, `routes.ts` broadcast). Pass CLIs only the env vars they need.

### T102 — Restrict CORS to local origin
- `app.use(cors())` (`index.ts:12`) is wide open → any visited website can drive `localhost:8787` (DNS-rebind/CSRF), spend CLI quota, read run records.

### T103 — Sanitize flowId against path traversal
- `flowId` flows unsanitized into `path.join` (`storage.ts:24,28,45,53`); `../../x` escapes the data dir.

### T104 — Validate API boundaries with zod
- `zod` is a dep used nowhere; `PUT /flows/:id` trusts `body.flow` wholesale (`routes.ts:65-83`); invalid `schedule`/nodes/edges persist silently.

### T105 — Error middleware, process handlers, graceful shutdown
- Async handlers lack try/catch (Express 5 needs error middleware); no `uncaughtException`/`unhandledRejection`/`SIGTERM` handling; SSE clients never flushed on exit.

### T201 — SSE heartbeat + guarded broadcast + client cap
- No keep-alive ping (idle proxy drops stream); `broadcast` writes unguarded (`routes.ts`) → dead/slow client can throw into the step loop or back-pressure `runFlow`.

### T202 — Per-flow write serialization
- `appendRun` read-modify-writes `runs/<id>.json` (`storage.ts:43-49`); manual `POST /runs` bypasses scheduler single-flight → interleaved write drops records.

### T203 — Executor output byte cap
- `executor.ts:14-18` buffers unbounded stdout/stderr → OOM on runaway CLI.

### T204 — Make scheduler actually fire
- `nextRunAt` is computed but never scheduled — no timer; `flow.schedule` stored but never runs. Per-provider spacing also absent (spec invariant 3). Confirm scope vs spec before build.

### T205 — Rate-limit /runs + startup env validation
- No rate limit on subprocess-spawning `/runs`; `PORT` parsed as NaN-prone `Number`; missing auth tokens fail opaquely at run time.

### T301 — Inspector reads real selected node + controlled inputs
- `Inspector.tsx:10` infers block type from a substring of the node *id* (wrong for transform/output/most nodes); inputs are uncontrolled `defaultValue` with no `onChange` → edits never persist; tabs are dead buttons.

### T302 — ConsolePanel detail from real RunRecord
- `ConsolePanel.tsx:57-73` hardcodes "Step 1: Search Reddit / Exit 0 / Records 87 / fake output path" — misleading + redaction-adjacent.

### T303 — BlockNode renders real status
- `BlockNode.tsx:16` always shows green `CheckCircle2`; nodes seeded `'success'` (`useFlowState.ts:21-26`) before any run → false "all passed".

### T304 — TopBar surfaces real provider health
- `TopBar.tsx:25-26` hardcodes "Healthy"; `fetchHealth` exists but unused → missing-binary (core spec req) never shown.

### T305 — Error-state surfacing + aria-live
- Run errors route into success-green validation box (`styles.css:480-491`); no aria-live → SR users get no run status; failures look like success.

### T401 — Keyboard-accessible block authoring
- Palette items are `<div draggable>` only (`BlockPalette.tsx:49-56`) — no `role`/`tabIndex`/click/keyboard → keyboard + SR users cannot build a flow (the primary action).

### T402 — Visible focus rings + shortcut affordances `[P]`
- No `:focus-visible` styles anywhere; canvas `tabIndex=0` has no focus cue; `⌘K` kbd badge has no handler.

### T403 — Real ARIA tabs `[P]`
- Inspector/Console "tabs" lack `role="tab"`/`aria-selected`/`tabpanel`/arrow-key nav.

### T404 — Empty/first-run states + stable keys + log cap `[P]`
- No canvas/results/console empty states; `key={log}`/`kind-title` keys collide (`ConsolePanel.tsx:53,96`); logs uncapped (`useFlowState.ts:151-155`).

### T405 — Enforce mobile read-only
- Spec: mobile = read-only monitor. `@media(max-width:900px)` only reflows; drag/run/edit still active.

### T501 — Narrow recompute scope
- `selectedCommand`/`runNow` depend on whole `nodes` array (`useFlowState.ts:77-87`); `isValidConnection` on `[nodes]` (`Canvas.tsx:74-91`); `nodeTypeMap` rebuilt per SSE step (`useFlowState.ts:108,112`) → wide re-compute/re-render every drag frame + every step.

### T502 — History snapshot on drag commit `[P]`
- `pushHistory` snapshots full graph per `position` change (`Canvas.tsx:59-72`) → dozens of deep copies/sec, undo stack burns on one drag.

### T503 — Vite production build config
- `vite.config.ts` is `vitest/config` with no `build` block; `@xyflow/react`+`lucide-react` unsplit in main chunk. `[tdd:skip:build-config]` — config, verified by build output.

### T601 — Single-process prod serve + server build
- No server build (`tsconfig.node.json` `noEmit`); no `express.static` → no real run-in-prod path. **Spec delta** (deployment model).

### T602 — Structured logging
- Only two `console.log`s; no request/error logging. `[tdd:skip:observability-wiring]`.

### T603 — Dockerfile + README + env docs
- No Dockerfile/.dockerignore/README run path. `[tdd:skip:docs-only]`.

### T604 — E2E for critical flows + CI gate
- e2e covers keyboard add-block, run + live steps, error surface, mobile read-only; `test:run` + `test:e2e` + `lint` wired as a CI gate; all green.

---

## Completed

<!-- Add tasks with cc:done or pm:approved here. -->

- [x] Wire frontend to backend run engine `cc:done [c00b9d7]` (2026-06-06)
  - `runNow` validates via shared `validateFlow`, PUTs the flow, POSTs `/api/runs`, maps `RunRecord` to the console; SSE `/events` drives live step updates
  - New pure modules `flowSerialization` + `runConsole` (unit-tested); api client `saveFlow`/`postRun`/`subscribeRunEvents`; flow/run types moved to shared core
- [x] Harness project setup (CLAUDE.md, Plans.md, hooks, sync, doctor) `pm:approved` (2026-06-06)

---

## Archive

<!-- Move older completed tasks here. -->

---

## Status Marker Legend

These markers are protocol values used by Harness tooling. Keep them unchanged
unless the project has tested parser aliases.

| Marker | Meaning |
|--------|---------|
| `pm:requested` | PM requested work |
| `cc:todo` | Not started by Claude Code |
| `cc:wip` | Claude Code is working |
| `cc:done` | Claude Code completed the task and is awaiting confirmation |
| `pm:approved` | PM confirmed completion |
| `blocked` | Blocked; include the reason next to the task |

---

## Last Update

- **Updated at**: 2026-06-06
- **Last session owner**: Claude Code
- **Branch**: codex/social-cli-canvas-implementation
