# HTML Run Report + In-App Link — Design

**Date:** 2026-06-07
**Status:** Implemented (2026-06-07)
**Related:** [2026-06-06-social-cli-canvas-automation-ui-design.md](./2026-06-06-social-cli-canvas-automation-ui-design.md)

> **Implementation notes.** Shipped per this design (all files in the table below).
> Two security hardenings were added beyond the original route section after an
> adversarial review:
> - `GET /api/artifacts/*` re-checks the **real** path (`fs.realpath`) after
>   `resolveContainedPath`, so a symlink planted inside the artifacts dir cannot
>   point outside it. Both sides are realpath'd to avoid false rejections on a
>   symlinked base (e.g. macOS `/var` → `/private/var`).
> - The artifact response sets `X-Content-Type-Options: nosniff` and a
>   `Content-Security-Policy` (`default-src 'none'`; inline style/script + https
>   images allowed; `connect-src`/`form-action`/`frame-ancestors 'none'`) — the
>   report's own inline JS still runs while exfiltration channels are blocked if
>   escaping ever regresses.
>
> The live search filters visible text only (per the design); abbreviated counts
> (`1.5k`) are intentionally not matchable by raw number (YAGNI).

## Problem

Run results (the normalized `SocialItem[]` rows) currently exist only as raw
artifact files on disk (`outputs/*.json`, `*.csv`, `*.md`). The `RunRecord`
deliberately carries no rows — only step status + output-file metadata (see the
comment in [src/runConsole.ts](../../../src/runConsole.ts)). To read results the
user opens raw JSON files in an editor. There is no pleasant way to view a run's
output.

## Goal

Give runs a nice, readable results UI. Two deliverables (user chose "Both"):

1. **Core:** a self-contained, styled **HTML report** written as an artifact by a
   new `output.exportHtml` block — opens offline in any browser, shareable,
   archivable.
2. **In-app link:** after a run produces an HTML report, the workbench shows an
   **"Open report ↗"** action that opens it in a new tab.

This mirrors the existing exporter pattern (`serializeJson` / `serializeCsv` /
`serializeMarkdown` + `output.*` blocks). **No `RunRecord` schema change.**

## Non-goals

- No in-app React results gallery (rejected in favor of the HTML report).
- No change to `SocialItem`, run records, normalizers, or the run engine's
  data flow beyond adding one `writeOutput` branch.
- No write/auth actions (V1 stays read-only).

## Architecture

### 1. `src/shared/htmlReport.ts` (new, isomorphic)

Pure function, no Node APIs — unit-testable like the other serializers. Lives in
its own file (not `exporters.ts`) to keep the simple serializers focused; the
HTML template + escaping is substantial enough to warrant a module.

```ts
export interface HtmlReportMeta {
  flowName: string;
  generatedAt: string; // ISO; caller supplies (engine passes run time)
}

export function serializeHtml(items: SocialItem[], meta: HtmlReportMeta): string;
```

Output is **one** `.html` string:

- Inline `<style>` (no external CSS) and inline vanilla `<script>` (no deps) —
  fully self-contained, works from `file://`.
- **Sticky header:** flow name, total count, per-platform breakdown
  (reddit / x counts), generated timestamp.
- **Controls:** live search box (filters by visible text), sort (score / date),
  platform filter (all / reddit / x). JS filters/sorts the **already-rendered
  DOM cards** — no client-side templating, so all escaping happens once at
  generation time.
- **Card grid (responsive):** one card per `SocialItem`:
  - platform badge (reddit orange `#FF4500`, x dark accent),
  - `r/community` or `@author`,
  - title (reddit) / text (x), truncated with full text on the card,
  - platform-relevant engagement: reddit `↑score 💬comments`,
    x `♥likes 🔁retweets 👁views`,
  - formatted `createdAt`,
  - "open original ↗" link (sanitized),
  - media thumbnail when `media[0]` is an image URL.
- **Empty state:** clean "no items" message when `items` is empty.
- Polished dark aesthetic, distinct from generic output (frontend-design pass
  during implementation).

#### Security (CRITICAL — report embeds untrusted fetched content)

The report renders external, attacker-influenceable strings (titles, bodies,
authors, community, URLs). Stored-XSS risk if rendered raw.

- `escapeHtml(value)` applied to **every** interpolated text value
  (`& < > " '`).
- `safeHref(url)` returns the URL only if it parses as `http:`/`https:`;
  otherwise omits the link. Blocks `javascript:`, `data:`, etc. The href value
  is also attribute-escaped.
- **Never** render `item.raw` (unknown content + bloat).
- Engagement numbers are coerced to `Number`/`null` before rendering.

These belong to security invariant 2 (no leak) and general untrusted-input
handling. Covered by unit tests with hostile inputs.

### 2. Block: `output.exportHtml` ([src/shared/blockSpecs.ts](../../../src/shared/blockSpecs.ts))

New `BlockSpec`, mirroring `output.exportMarkdown`:

```ts
{
  type: 'output.exportHtml',
  label: 'Export HTML Report',
  provider: 'local',
  category: 'Output',
  priority: 'P1',
  description: 'Write a styled, self-contained HTML report of results.',
  ports: { input: [socialArrayPort], output: [artifactPort] },
  fields: [{ key: 'path', label: 'Path', type: 'path', required: true }],
  defaultSettings: { path: 'outputs/report.html' }
}
```

No `commandBuilders` change (local block, not CLI).

### 3. Run engine ([server/runEngine.ts](../../../server/runEngine.ts))

Add one branch in `writeOutput`:

```ts
if (node.type === 'output.exportHtml') {
  return writeArtifact(filePath, serializeHtml(items, {
    flowName: ...,        // flow name threaded into writeOutput
    generatedAt: now.toISOString()
  }));
}
```

`writeOutput` currently has no flow name; thread `flowName` (and the already
available `now`) through from `runFlow`. Path is timestamped by the existing
`buildTimestampedExportPath` → `outputs/report-<ts>.html`.

### 4. Serve route: `GET /api/artifacts/*` ([server/routes.ts](../../../server/routes.ts))

Read-only static-ish handler for files under `<dataDir>/artifacts`:

- Resolve the requested relative path with the existing
  `resolveContainedPath(artifactsDir, relPath)` — rejects traversal
  (`..`, absolute paths) by throwing; handler returns 400/404 on rejection.
- Set `Content-Type` by extension (`.html`, `.json`, `.csv`, `.md`); default
  `text/plain`.
- Send file contents; 404 when missing.
- GET only. Confirm `csrfGuard` does not block safe methods (it should only
  guard mutating verbs); if it does, allow GET on this path.

Vite already proxies `/api`, so the dev frontend reaches it unchanged.

### 5. In-app link

- Extend `ConsoleState` (in [src/api.ts](../../../src/api.ts)) with optional
  `reportPath?: string`.
- In `runRecordToConsoleState` ([src/runConsole.ts](../../../src/runConsole.ts)),
  set `reportPath` to the **last** `outputFiles` entry ending in `.html`
  (most recent report), else leave undefined.
- [src/components/ConsolePanel.tsx](../../../src/components/ConsolePanel.tsx):
  when `state.reportPath` is set, render an **"Open report ↗"** anchor in the
  console head that opens `/api/artifacts/${reportPath}` with
  `target="_blank" rel="noopener noreferrer"`.

## Data flow

```
output.exportHtml node
  → runEngine writeOutput → serializeHtml(items, {flowName, generatedAt})
  → writeArtifact → outputs/report-<ts>.html on disk
  → RunRecord.outputFiles += { path, bytes }
  → frontend: runRecordToConsoleState sets reportPath
  → ConsolePanel "Open report ↗" → GET /api/artifacts/outputs/report-<ts>.html
  → browser renders self-contained report
```

## Testing

- `tests/htmlReport.test.ts` (new):
  - escapes `& < > " '` in title/body/author/community;
  - `safeHref` keeps `http(s)`, drops `javascript:`/`data:`/malformed;
  - never includes `raw` contents;
  - header counts + per-platform breakdown correct;
  - empty `items` → valid empty-state HTML;
  - reddit vs x engagement rendering.
- `tests/commandBuilders.test.ts` (or blockSpec test): `output.exportHtml`
  registered, has required `path` field + default.
- `tests/runEngine.test.ts`: a flow with `output.exportHtml` writes one `.html`
  artifact; `outputFiles` records it.
- Serve route test (new or in existing routes test): contained path served;
  traversal (`../`) rejected; correct content-type.
- Frontend: `runRecordToConsoleState` sets `reportPath` from `.html` output;
  unit-level assertion (existing runConsole/console tests pattern).

## Files touched

| File | Change |
|------|--------|
| `src/shared/htmlReport.ts` | **new** — `serializeHtml` + `escapeHtml`/`safeHref` |
| `src/shared/blockSpecs.ts` | add `output.exportHtml` spec |
| `server/runEngine.ts` | `writeOutput` html branch + thread `flowName` |
| `server/routes.ts` | `GET /api/artifacts/*` |
| `src/api.ts` | `ConsoleState.reportPath?` |
| `src/runConsole.ts` | set `reportPath` from html output files |
| `src/components/ConsolePanel.tsx` | "Open report ↗" link |
| `tests/htmlReport.test.ts` | **new** |
| `tests/runEngine.test.ts`, `tests/commandBuilders.test.ts` | new cases |
| routes test | artifact-serve cases |

## Risks / mitigations

- **XSS in report** → centralized escaping + href allowlist + hostile-input
  tests. Highest-priority concern.
- **Path traversal via serve route** → reuse `resolveContainedPath`; test `../`.
- **CSRF guard blocking GET** → verify guard scope; GET is safe.
- **Large result sets** → cards are static DOM; acceptable for local single-user
  V1. (No virtualization in scope; YAGNI.)
