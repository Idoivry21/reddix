# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Reddix** (working name) is a **local, single-user** canvas automation workbench that wraps two external CLIs — `rdt-cli` (Reddit, binary `rdt`) and `twitter-cli` (X/Twitter, binary `twitter`). Users drag blocks onto a freeform node canvas, connect them, configure settings, then run flows manually or on a schedule and export the results.

V1 is **read-only research/export only**. Authenticated write actions (post/comment/vote/like/retweet) are explicitly out of scope. There is **no database** — persistence is local JSON. The CLIs are **not bundled**; the app detects and reports missing binaries.

Full product spec: [docs/superpowers/specs/2026-06-06-social-cli-canvas-automation-ui-design.md](docs/superpowers/specs/2026-06-06-social-cli-canvas-automation-ui-design.md). Read it before any non-trivial feature work — it defines the data model, execution semantics, and the security invariants below as hard requirements.

## Commands

```bash
npm run dev          # Vite frontend on http://127.0.0.1:5173 (proxies /api and /events to backend)
npm run dev:server   # Express backend on http://127.0.0.1:8787 (tsx watch)
npm start            # backend, no watch
npm run build        # tsc -b (type-check both projects) then vite build
npm run lint         # tsc -b --noEmit — this is the ONLY lint/typecheck; there is no ESLint
npm test             # vitest watch
npm run test:run     # vitest run (CI)
npm run test:e2e     # playwright; auto-starts the Vite dev server
```

Run a single unit test file or by name:

```bash
npx vitest run tests/graph.test.ts
npx vitest run -t "rejects incompatible ports"
npx playwright test tests/e2e/workbench.spec.ts
```

Both halves must run for a full local session: start the backend (`dev:server`) **and** the frontend (`dev`). Playwright runs two projects: `chromium-desktop` (authoring) and `chromium-mobile-readonly` (mobile is monitor/read-only by design).

### Environment

- `PORT` — backend port (default `8787`).
- `REDDIX_ALLOWED_ORIGINS` — comma-separated CORS allowlist (default `http://127.0.0.1:5173,http://localhost:5173`, the local Vite dev origins). Foreign origins are rejected to block DNS-rebind/CSRF against localhost.
- `REDDIX_DATA_DIR` — JSON store + artifact location (default `.reddix-data/`, git-ignored).
- `TWITTER_AUTH_TOKEN`, `TWITTER_CT0` — consumed from the environment by `twitter-cli` for auth-required blocks. The app **reads but never persists or prints** these.

## Architecture

Single npm package, two halves plus a shared core. The TypeScript build is split into two project references ([tsconfig.app.json](tsconfig.app.json) = `src`, [tsconfig.node.json](tsconfig.node.json) = `server` + `src/shared` + config).

```
src/            React + Vite frontend (bespoke canvas UI, no canvas library)
server/         Express backend that spawns the CLIs (tsx, no build step to run)
src/shared/     ISOMORPHIC core imported by BOTH frontend and backend
```

### The shared core is the heart of the system

`src/shared/` is imported by the frontend (relative) **and** by the backend (`../src/shared/...` — see [server/runEngine.ts](server/runEngine.ts)). Anything the UI's command preview and the backend's execution must agree on lives here, so they can never drift:

- [blockSpecs.ts](src/shared/blockSpecs.ts) — the single block registry. Each block declares `type`, `provider`, `category`, `priority`, typed `ports`, `fields`, `defaultSettings`, and (for CLI blocks) its `executable`.
- [commandBuilders.ts](src/shared/commandBuilders.ts) — maps a block type to a `BuiltCommand` (argv array) via a `switch`. Also the registry accessors (`getBlockSpec`, `getDefaultSettings`, `previewCommand`).
- [graph.ts](src/shared/graph.ts) — `canConnect` (port-type compatibility) and `validateFlow` (required fields, valid edges, no cycles, every Output reachable from a Source).
- [normalizers.ts](src/shared/normalizers.ts) — map each provider's `--json` payload onto the normalized `SocialItem`.
- [transforms.ts](src/shared/transforms.ts) — `applyLimit` / `applyFilterText` / `applyEngagementFilter`, etc., operating on `SocialItem[]`.
- [exporters.ts](src/shared/exporters.ts) — JSON/CSV/Markdown serializers + timestamped export paths.
- [redaction.ts](src/shared/redaction.ts) — strips secret values from any string/argv before display or storage.
- [types.ts](src/shared/types.ts) — shared types incl. the `SocialItem` shape both providers normalize to.

### Block types and how to add one

Block types are namespaced strings: `reddit.*`, `twitter.*` (CLI-backed), `transform.*`, `output.*`, `utility.*` (local). `runEngine` decides CLI-vs-local by prefix (`reddit.`/`twitter.` → spawn a CLI). To add a block, touch **three** places:

1. Add a `BlockSpec` to [blockSpecs.ts](src/shared/blockSpecs.ts).
2. CLI block → add a `case` in `buildBlockCommand` ([commandBuilders.ts](src/shared/commandBuilders.ts)). Transform/output block → add a branch in `runFlow` ([server/runEngine.ts](server/runEngine.ts)).
3. Add unit tests (every command builder, transform, and graph rule is expected to be tested — see `tests/`).

### Execution model (server/runEngine.ts)

`runFlow` validates the flow, topologically sorts the DAG, then walks nodes in order:

- **CLI nodes** build an argv via `buildBlockCommand` → `executor(command)` → parse JSON (payloads read from `.data` envelope) → `normalize*Payload` to `SocialItem[]`.
- **Local nodes** consume upstream `SocialItem[]` (gathered from incoming edges) and apply a transform or write an export artifact.
- **Continue-on-error is the default**: a failed step marks all downstream-dependent nodes `skipped`; unrelated branches still run. A flow-level `failFast` toggle stops on first failure.
- Every step records status, `displayArgv`, exit code, stdout summary, stderr, and timestamps into the `RunRecord`.

### Backend wiring (server/)

- [routes.ts](server/routes.ts) — REST under `/api` (`/health`, `/blocks`, `/flows`, `/flows/:id`, `/runs`, `/runs/:flowId`, `/schedules/:flowId/trigger`) plus **SSE at `/events`** for live run-step streaming (Vite proxies `/events`).
- [executor.ts](server/executor.ts) — spawns the CLI with **`shell: false`** and an argv array; also `checkExecutable` for health checks.
- [scheduler.ts](server/scheduler.ts) — in-memory, **single-flight per flow** (overlapping trigger → `onSkip`, recorded not queued), enforces a minimum interval (15 min) plus jitter.
- [storage.ts](server/storage.ts) — JSON files under `REDDIX_DATA_DIR`: `flows/<id>.json`, `runs/<flowId>.json` (capped, default 50/flow), `preferences.json`. Records are `schemaVersion`-tagged with migrate-on-load. No DB.

### Frontend (src/)

[App.tsx](src/App.tsx) renders the workbench: `TopBar`, `BlockPalette`, `Canvas` (a bespoke `@xyflow`-free canvas in [Canvas.tsx](src/components/Canvas.tsx)), `Inspector`, `ConsolePanel`. State is driven by the `useWorkbenchState` hook in [useFlowState.ts](src/hooks/useFlowState.ts).

> **Wiring:** the frontend is wired to the backend through [api.ts](src/api.ts). `runNow` validates the flow locally (`validateFlow`), persists it via `PUT /api/flows/:id`, `POST`s `/api/runs`, then hydrates console + node statuses from the returned `RunRecord`; live run steps stream over SSE (`/events`). Drive any new behavior through the existing `/api` routes and the shared `commandBuilders`/`graph` modules — do not duplicate that logic in the frontend.

## Security invariants (non-negotiable — enforced by tests)

These come straight from the spec and must hold for any change:

1. **No shell strings, ever.** Commands are argv arrays built only from allowlisted block specs; user input is a value in the array, never interpolated. `executor.ts` spawns with `shell: false`.
2. **Secrets never leak.** Auth tokens must not appear in flow JSON, run records, the command trace, or logs. `redaction.ts` scrubs them; a `BuiltCommand` carries both `argv` (real) and `displayArgv` (what is shown/stored) — display/persist the redacted one.
3. **Never out-run the CLIs' own throttling.** `rdt-cli`/`twitter-cli` apply their own backoff/jitter; the app adds minimum schedule interval, jitter, single-flight, and per-provider spacing on top — it must not disable or undercut the CLIs' limits.

## Conventions

- Immutable updates only (spread, no in-place mutation) — see the helpers in `runEngine.ts`/`graph.ts` for the established style.
- Validate external/untrusted data at boundaries; the project uses `zod` (a dependency) for schema validation.
- Avoid `any`; narrow `unknown`. Explicit types on exported/shared APIs, inference for locals.
- The `SocialItem` shape is a contract: fields absent for a platform are `null`, never invented. Transforms, Merge Streams, and all exporters depend on this single shape.
