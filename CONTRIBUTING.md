# Contributing

Reddix is a local, single-user workbench. Keep changes aligned with that threat
model: read-only social research/export, local JSON persistence, and no bundled
third-party CLIs.

## Setup

```bash
npm install
cp .env.example .env   # optional; defaults work for local development
npm run dev:server
npm run dev
```

Use Node.js 20.19+ or 22.12+. Open http://127.0.0.1:5173. Optional `rdt` and
`twitter` binaries can be on your `PATH`; the app runs without them and reports
missing provider health.

## Before Opening a Pull Request

Run the same checks CI runs:

```bash
npm run lint
npm run test:run
npm run build
npm run test:e2e
```

For documentation-only changes, explain which checks were skipped and why.

## Security Invariants

Every code change must preserve these rules:

1. Commands use argv arrays and `shell: false`; never build shell strings from
   user input.
2. Secrets must not be stored, streamed, rendered, or logged. Use the shared
   redaction helpers for every persisted or user-visible command/run field.
3. Scheduling must not bypass the underlying CLIs' own throttling or the app's
   local rate limits.
4. Artifact paths must stay inside `REDDIX_DATA_DIR/artifacts`, including the
   served `/api/artifacts/*` route. Reject traversal and symlink escapes.
5. HTML reports render fetched social content, so escape text, allow only
   `http(s)` links, and preserve the report CSP.

Add or update tests whenever a change touches command construction, flow
validation, storage paths, run records, scheduling, logging, exports, or auth
handling. Use `tests/htmlReport.test.ts` and `tests/artifactServe.test.ts` as
the reference patterns for report/export safety.

## Dependency Changes

Keep dependencies small and directly justified. If a dependency affects runtime
execution, parsing, browser-exposed code, or local file access, call out the
risk and mitigation in the pull request.
