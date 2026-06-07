# Social CLI Canvas Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the V1 local canvas workbench for Reddit and X/Twitter CLI research/export flows.

**Status:** Implemented on `main` as of 2026-06-07. The checklist below is preserved as the original worker plan; current implementation notes override stale planning assumptions.

**Architecture:** A React + Vite + TypeScript frontend renders the canvas-first workbench with a bespoke DOM/SVG canvas. A local Express backend owns CLI health checks, safe argv command builders, run execution, SSE logs, local JSON persistence, exports, artifact serving, and an in-memory scheduler. Shared TypeScript modules define block specs, graph validation, normalized social items, redaction, filtering, exports, HTML reports, and persistence shapes.

**Tech Stack:** React, Vite, TypeScript, Express, Vitest, Testing Library, Playwright.

---

### Task 1: Scaffold Project And Test Harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles.css`
- Create: `server/index.ts`
- Create: `tests/setup.ts`

- [ ] Create the Vite/React/TypeScript project files with scripts: `dev`, `dev:server`, `build`, `test`, `test:run`, `lint`, and `start`.
- [ ] Install dependencies: React, Vite, TypeScript, Express, cors, zod, nanoid, lucide-react, Vitest, Testing Library, jsdom, Playwright.
- [ ] Run `npm test -- --run` and verify the test harness starts.
- [ ] Commit scaffold with message `chore: scaffold social cli workbench`.

### Task 2: Shared Domain, Block Specs, And Command Builders

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/blockSpecs.ts`
- Create: `src/shared/commandBuilders.ts`
- Create: `src/shared/redaction.ts`
- Create: `tests/commandBuilders.test.ts`
- Create: `tests/redaction.test.ts`

- [ ] Write failing tests proving Reddit Search and Twitter Search produce fixed argv arrays and preserve user input as one argv value.
- [ ] Write failing tests proving `TWITTER_AUTH_TOKEN` and `TWITTER_CT0` are redacted from previews/run records/logs.
- [ ] Implement shared types, P0/P1 block specs, typed ports, provider metadata, command preview text, and safe argv builders.
- [ ] Run `npm test -- --run tests/commandBuilders.test.ts tests/redaction.test.ts`.
- [ ] Commit with message `feat: add provider block specs and safe command builders`.

### Task 3: Graph Validation, Normalization, Transforms, And Exports

**Files:**
- Create: `src/shared/graph.ts`
- Create: `src/shared/normalizers.ts`
- Create: `src/shared/transforms.ts`
- Create: `src/shared/exporters.ts`
- Create: `tests/graph.test.ts`
- Create: `tests/normalizers.test.ts`
- Create: `tests/transforms.test.ts`
- Create: `tests/exporters.test.ts`

- [ ] Write failing tests for invalid port connections, cycles, missing required settings, and unreachable output blocks.
- [ ] Write failing tests for Reddit/Twitter sample payload normalization into `SocialItem`.
- [ ] Write failing tests for Limit, Filter Text, Engagement Filter, JSON/CSV/Markdown export serialization, and timestamped filenames.
- [ ] Implement the graph, normalizer, transform, and export helpers.
- [ ] Run the focused test files and commit with message `feat: add graph validation and social item processing`.

### Task 4: Local Persistence, Run Engine, SSE, And Scheduler

**Files:**
- Create: `server/storage.ts`
- Create: `server/executor.ts`
- Create: `server/runEngine.ts`
- Create: `server/scheduler.ts`
- Create: `server/routes.ts`
- Create: `tests/storage.test.ts`
- Create: `tests/runEngine.test.ts`
- Create: `tests/scheduler.test.ts`

- [ ] Write failing tests for schema migration, lossless flow round-trip, capped run history, partial failure, single-flight overlap skip, and fake executor output.
- [ ] Implement JSON storage under `REDDIX_DATA_DIR` with migrations and bounded history.
- [ ] Implement CLI executor abstraction, run engine with continue-on-error, redaction, provider serialization, and result normalization.
- [ ] Implement Express REST routes and SSE event stream for health, flows, runs, schedules, and exports.
- [ ] Implement in-memory interval scheduler with minimum interval, jitter, pause/resume, and overlap skip record.
- [ ] Run backend tests and commit with message `feat: add local backend run engine and scheduler`.

### Task 5: Canvas Workbench UI

**Files:**
- Create: `src/components/TopBar.tsx`
- Create: `src/components/BlockPalette.tsx`
- Create: `src/components/Canvas.tsx`
- Create: `src/components/BlockNode.tsx`
- Create: `src/components/Inspector.tsx`
- Create: `src/components/ConsolePanel.tsx`
- Create: `src/components/ScheduleModal.tsx`
- Create: `src/components/Dashboard.tsx`
- Create: `src/components/RunStatusBar.tsx`
- Create: `src/components/ToastViewport.tsx`
- Create: `src/hooks/useFlowState.ts`
- Create: `src/api.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] Implement the layout from the generated concept: top bar, provider palette, bespoke canvas with starter nodes, inspector, bottom console, and controls.
- [ ] Implement drag/drop from palette, valid connections, selection, settings edits, delete, duplicate, copy/paste, undo/redo, keyboard shortcuts, save, run, schedule controls, and output preview.
- [ ] Implement missing CLI/auth/error/loading/empty states from the spec.
- [ ] Keep mobile to monitor/read-only behavior; desktop authoring remains primary.
- [ ] Run `npm test -- --run` and `npm run build`.
- [ ] Commit with message `feat: build canvas automation workbench ui`.

### Task 6: Browser QA And Finish

**Files:**
- Create: `tests/e2e/workbench.spec.ts`
- Modify as needed based on QA.

- [ ] Add browser test covering starter canvas render, palette search, selection/inspector edit, invalid connection reason, run flow with fake executor, and schedule pause/resume.
- [ ] Start the local dev server and open it in the Browser/IAB.
- [ ] Compare rendered workbench against `/Users/ido/.codex/generated_images/019e9c08-38eb-7113-b39f-3c402e524058/ig_0d84da581c2a19ea016a2408615a188191b8defb7a5cabdddd.png`.
- [ ] Verify desktop and mobile/read-only viewport behavior, core interaction path, no clipped text, no inert primary controls, no visible secret leakage.
- [ ] Run final `npm test -- --run`, `npm run build`, and browser test.
- [ ] Commit final fixes with message `test: add workbench browser coverage`.
