# Reddix

A **local, single-user** canvas automation workbench that wraps two external
CLIs — `rdt-cli` (Reddit, binary `rdt`) and `twitter-cli` (X/Twitter, binary
`twitter`). Drag blocks onto a freeform node canvas, connect them, configure
settings, then run flows manually or on a schedule and export the results.

**V1 is read-only research/export only.** Authenticated write actions
(post/comment/vote/like/retweet) are out of scope. There is **no database** —
persistence is local JSON. The CLIs are **not bundled**; the app detects and
reports missing binaries.

See the full product spec in
[docs/superpowers/specs/2026-06-06-social-cli-canvas-automation-ui-design.md](docs/superpowers/specs/2026-06-06-social-cli-canvas-automation-ui-design.md).

## Requirements

- Node.js 20+
- Optional: `rdt` and `twitter` on your `PATH` for CLI-backed blocks (the app
  runs without them and shows their health as "Missing").

## Development

Run both halves in separate terminals:

```bash
npm install
npm run dev:server   # Express backend on http://127.0.0.1:8787 (tsx watch)
npm run dev          # Vite frontend on http://127.0.0.1:5173 (proxies /api and /events)
```

Open http://127.0.0.1:5173.

## Production (single process)

`npm run serve` builds the frontend and serves the built `dist/` **and** the API
from one Express process:

```bash
npm run serve        # builds, then serves UI + API on http://127.0.0.1:8787
```

Open http://127.0.0.1:8787. Static assets, `/api/*`, and the `/events` SSE
stream are all served from the same origin, so no proxy is needed in production.

## Docker

```bash
docker build -t reddix .
# Keep it on the host loopback and persist data to a local ./data dir:
docker run --rm -p 127.0.0.1:8787:8787 -v "$PWD/data:/data" reddix
```

The image binds `HOST=0.0.0.0` (required inside containers); the `-p
127.0.0.1:...` mapping keeps it reachable only from your machine. The CLIs are
not in the image — install them into the image or mount them if you need
CLI-backed blocks.

## Testing

```bash
npm run lint         # tsc -b --noEmit (the only typecheck/lint)
npm run test:run     # vitest (unit/integration)
npm run test:e2e     # playwright (desktop authoring + mobile read-only)
```

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8787` | Backend port. Validated at startup. |
| `HOST` | `127.0.0.1` | Bind address. Set `0.0.0.0` only for containers. |
| `REDDIX_ALLOWED_ORIGINS` | `http://127.0.0.1:5173,http://localhost:5173` | Comma-separated CORS allowlist. Foreign origins are rejected (blocks DNS-rebind/CSRF). |
| `REDDIX_DATA_DIR` | `.reddix-data/` | JSON store + export artifacts (git-ignored). |
| `REDDIX_STATIC_DIR` | `./dist` | Built SPA directory served in production. |
| `REDDIX_MAX_OUTPUT_BYTES` | `10485760` | Per-stream cap on CLI stdout/stderr (OOM guard). |
| `TWITTER_AUTH_TOKEN`, `TWITTER_CT0` | – | Consumed by `twitter-cli` for auth-required blocks. **Read but never persisted or printed.** |

## Security invariants (non-negotiable)

1. **No shell strings.** Commands are argv arrays built only from allowlisted
   block specs; user input is a value in the array, never interpolated. The
   executor spawns with `shell: false`.
2. **Secrets never leak.** Auth tokens must not appear in flow JSON, run
   records, the command trace, the SSE stream, or logs. Redaction scrubs them;
   the redacted `displayArgv` is what is shown/stored.
3. **Never out-run the CLIs' own throttling.** The app adds a minimum schedule
   interval, jitter, single-flight per flow, per-provider spacing, and a /runs
   rate limit on top of the CLIs' built-in backoff — it never disables them.

Flow ids and export paths are validated to stay inside the data directory
(path-traversal blocked), and API request bodies are validated with `zod`.
