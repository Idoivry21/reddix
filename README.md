<div align="center">

# 🔭 Reddix

**Local canvas automation for read-only Reddit & X/Twitter research**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-20.19%2B-339933?logo=node.js&logoColor=white)](#requirements)
[![Tests](https://img.shields.io/badge/tests-Vitest%20%2B%20Playwright-6E9F18.svg)](#testing)

[Quick Start](#development) · [Credentials](#credentials) · [Tool choices](#current-tool-choices) · [Outputs](#outputs-and-reports) · [Security](#security-invariants-non-negotiable) · [Spec](docs/superpowers/specs/2026-06-06-social-cli-canvas-automation-ui-design.md)

</div>

A **local, single-user** canvas automation workbench that wraps two external
CLIs — `rdt-cli` (Reddit, binary `rdt`) and `twitter-cli` (X/Twitter, binary
`twitter`). Drag blocks onto a freeform node canvas, connect them, configure
settings, then run flows manually or on a schedule. Results can be exported as
JSON, CSV, Markdown, self-contained HTML reports, or delivered to an HTTPS
webhook.

**V1 is read-only research/export only.** Authenticated write actions
(post/comment/vote/like/retweet) are out of scope. There is **no database** —
persistence is local JSON. The CLIs are **not bundled**; the app detects and
reports missing binaries.

See the full product spec in
[docs/superpowers/specs/2026-06-06-social-cli-canvas-automation-ui-design.md](docs/superpowers/specs/2026-06-06-social-cli-canvas-automation-ui-design.md).

## Project status

Reddix is pre-1.0. Expect APIs, flow JSON, and UI details to change while the
core local-first safety model stabilizes.

## Requirements

- Node.js 20.19+ or 22.12+
- Optional: `rdt` and `twitter` on your `PATH` for CLI-backed blocks (the app
  runs without them and shows their health as "Missing").

## Current tool choices

| Scenario | Tool | Why |
|----------|------|-----|
| Frontend app | React + TypeScript + Vite | Typed SPA workbench with fast local dev and production builds. |
| Canvas editor | Bespoke DOM/SVG canvas | Keeps node layout, drag/drop, pan/zoom, and mobile read-only behavior under direct project control. |
| Backend/API | Express + `tsx` | Small local API server for CLI health, flow persistence, run execution, SSE logs, schedules, and artifacts. |
| Validation | `zod` | Shared runtime validation for env values, API bodies, flows, schedules, and run records. |
| Persistence | Local JSON under `REDDIX_DATA_DIR` | Keeps V1 single-user and database-free while preserving flows, runs, preferences, and export artifacts. |
| Reddit provider | [`rdt-cli`](https://github.com/public-clis/rdt-cli) (`rdt`) | Upstream CLI for read-only Reddit search, browsing, and post reads. Installed separately. |
| X/Twitter provider | [`twitter-cli`](https://github.com/public-clis/twitter-cli) (`twitter`) | Upstream CLI for read-only X/Twitter search, feeds, users, tweets, bookmarks, and articles. Installed separately. |
| Icons | `lucide-react` | Lightweight icon set for app controls and provider/status UI. |
| Tests | Vitest + Testing Library + Playwright | Unit/integration coverage plus desktop authoring and mobile read-only end-to-end checks. |

These are the current choices. The social CLIs are intentionally **not bundled**:
Reddix detects whether they are available and reports missing provider health in
the UI.

## Credentials

Reddix never asks for, stores, or transmits your social account passwords. The
provider CLIs handle their own authentication; Reddix only spawns them and, for
X/Twitter, passes through two environment variables. You are responsible for
obtaining credentials in line with each platform's Terms of Service and
developer policies.

### Reddit (`rdt-cli`)

Reddit access goes through [`rdt-cli`](https://github.com/public-clis/rdt-cli),
which authenticates with **browser cookies** — no Reddit app, client ID, or
client secret is involved. Follow that project's docs for the authoritative
steps; the typical flow is:

1. Open any supported browser (Chrome, Firefox, Edge, or Brave), go to
   **[reddit.com](https://www.reddit.com)**, and sign in to your account.
2. Run **`rdt login`**. The CLI auto-detects your installed browsers and extracts
   the Reddit session cookies — it tries each browser in turn and uses the first
   with valid cookies.
3. Credentials are stored by the CLI at `~/.config/rdt-cli/credential.json`.
   Saved cookies are valid for ~7 days by default and are refreshed from the
   browser automatically when they expire.
4. Check status with **`rdt status`** (or `rdt whoami`), and clear stored
   credentials with **`rdt logout`**.

Reddix reads none of these values — login and the credential file live entirely
with `rdt-cli`. The cookies grant access to your Reddit account, so keep them
local and log out when you no longer need authenticated reads.

**If auto-detection fails** (e.g. an unsupported browser, or a `"database is
locked"` error), try these in order:

1. Confirm you are actually signed in to [reddit.com](https://www.reddit.com) in
   one of the supported browsers, then **fully close that browser** to release
   its cookie-database lock and run `rdt login` again.
2. Extract the cookies manually from your browser:
   - Open **DevTools → Application/Storage → Cookies → `https://www.reddit.com`**.
   - Locate the Reddit session cookies — typically **`reddit_session`** and the
     newer **`token_v2`** (some flows also use `loid`/`edgebucket`).
   - Copy their values.
3. Hand those cookies to `rdt-cli` the way its docs describe. `rdt-cli` does not
   expose a documented manual-entry flag in Reddix; the credential file lives at
   `~/.config/rdt-cli/credential.json`, so consult the
   [`rdt-cli` README / issues](https://github.com/public-clis/rdt-cli) for the
   exact file format before editing it by hand. Reddix never reads or writes this
   file.

### X/Twitter (`twitter-cli`)

X/Twitter access goes through
[`twitter-cli`](https://github.com/public-clis/twitter-cli). Auth-required
blocks (e.g. bookmarks, timeline, likes) need two session cookies from a
**logged-in** X account, supplied to Reddix as environment variables:

1. Sign in to **[x.com](https://x.com)** in a desktop browser.
2. Open the browser **DevTools → Application/Storage → Cookies → `https://x.com`**.
3. Copy the value of the **`auth_token`** cookie → set `TWITTER_AUTH_TOKEN`.
4. Copy the value of the **`ct0`** cookie → set `TWITTER_CT0`.
5. Put them in your local `.env` (copy from `.env.example`) or export them in the
   shell that launches the backend.

```bash
# .env (never commit real values)
TWITTER_AUTH_TOKEN=your_auth_token_cookie
TWITTER_CT0=your_ct0_cookie
```

These tokens are read from the environment at run time and are **never persisted
to flow JSON, run records, the command trace, the SSE stream, or logs** (see
[Security invariants](#security-invariants-non-negotiable)). They grant access to
your account, so treat them like passwords: keep them out of version control,
rotate them by logging out/in on x.com, and remove them when you no longer need
auth-required blocks. Many search/read blocks work without any X credentials.

## Development

Run both halves in separate terminals:

```bash
npm install
npm run dev:server   # Express backend on http://127.0.0.1:8787 (tsx watch)
npm run dev          # Vite frontend on http://127.0.0.1:5173 (proxies /api and /events)
```

Open http://127.0.0.1:5173.

For local configuration, copy `.env.example` to `.env` and change only the
values you need. Never commit real `TWITTER_AUTH_TOKEN` or `TWITTER_CT0` values.

## Production (single process)

`npm run serve` builds the frontend and serves the built `dist/` **and** the API
from one Express process:

```bash
npm run serve        # builds, then serves UI + API on http://127.0.0.1:8787
```

Open http://127.0.0.1:8787. Static assets, `/api/*`, and the `/events` SSE
stream are all served from the same origin, so no proxy is needed in production.

## Outputs and reports

Output artifacts are written under `REDDIX_DATA_DIR/artifacts/` with timestamped
filenames so repeated scheduled runs do not overwrite previous results.
`output.exportHtml` creates a styled, self-contained HTML report. When a run
produces one, the console shows an "Open report" link served by
`GET /api/artifacts/*`.

`output.webhook` sends the same normalized result set to an HTTPS endpoint. It
POSTs `{ flowName, runId, count, items }` as JSON and acts as a terminal sink:
it does not feed a response back into the flow. The optional `Auth Token Env Var`
setting stores only an environment variable name; the value is read at run time,
sent as `Authorization: Bearer <token>`, and redacted from run records, SSE
events, logs, and command traces. Webhook step output masks URLs to their origin
so path and query tokens do not show up in the UI.

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
npm run build        # typecheck + Vite production build
npm run test:e2e     # playwright (desktop authoring + mobile read-only)
```

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8787` | Backend port. Validated at startup. |
| `HOST` | `127.0.0.1` | Bind address. Set `0.0.0.0` only for containers. |
| `REDDIX_ALLOWED_ORIGINS` | `http://127.0.0.1:5173,http://localhost:5173` | Comma-separated CORS allowlist. Foreign origins are rejected (blocks DNS-rebind/CSRF). |
| `REDDIX_BACKEND_ORIGIN` | `http://127.0.0.1:8787` | Dev-only Vite proxy target for `/api` and `/events`. |
| `REDDIX_DATA_DIR` | `.reddix-data/` | JSON store + export artifacts (git-ignored). |
| `REDDIX_STATIC_DIR` | `./dist` | Built SPA directory served in production. |
| `REDDIX_MAX_OUTPUT_BYTES` | `10485760` | Per-stream cap on CLI stdout/stderr (OOM guard). |
| `TWITTER_AUTH_TOKEN`, `TWITTER_CT0` | – | Consumed by `twitter-cli` for auth-required blocks. **Read but never persisted or printed.** |
| `<WEBHOOK_TOKEN_ENV>` | – | Optional bearer token env var named by an `output.webhook` block. **Read at run time only, never stored or printed.** |

## Security invariants (non-negotiable)

1. **No shell strings.** Commands are argv arrays built only from allowlisted
   block specs; user input is a value in the array, never interpolated. The
   executor spawns with `shell: false`.
2. **Secrets never leak.** Auth tokens must not appear in flow JSON, run
   records, the command trace, the SSE stream, or logs. Redaction scrubs them;
   the redacted `displayArgv` is what is shown/stored. Webhook auth tokens are
   read from env vars, and webhook URLs are masked to origin in run output.
3. **Never out-run the CLIs' own throttling.** The app adds a minimum schedule
   interval, jitter, single-flight per flow, per-provider spacing, and a /runs
   rate limit on top of the CLIs' built-in backoff — it never disables them.
4. **Artifacts stay contained.** Export paths and `GET /api/artifacts/*` are
   resolved under the data directory; traversal and symlink escapes are rejected.
5. **HTML reports treat fetched content as hostile.** Report text is escaped,
   links are limited to `http(s)`, and served reports get `nosniff` plus a tight
   CSP.
6. **Webhook delivery is HTTPS-only.** The webhook block refuses non-HTTPS URLs,
   sends only POST JSON, and does not parse responses back into the flow.

Flow ids and export paths are validated to stay inside the data directory
(path-traversal blocked), and API request bodies are validated with `zod`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: preserve the security
invariants above, add tests around command/storage/run-record changes, and run
the CI-equivalent checks before opening a pull request.

## Security

Please do not report vulnerabilities with exploit details in public issues. See
[SECURITY.md](SECURITY.md) for the supported branch and reporting process.

## Credits

Reddix builds on the work of the open-source projects listed in
[Current tool choices](#current-tool-choices), especially
[`rdt-cli`](https://github.com/public-clis/rdt-cli) for Reddit access and
[`twitter-cli`](https://github.com/public-clis/twitter-cli) for X/Twitter
access. The application stack also depends on React, Vite, Express, `zod`,
`lucide-react`, Vitest, Testing Library, and Playwright.

These projects are credited for their tooling and libraries. They are not
bundled with Reddix unless listed as npm dependencies, and Reddix is not
affiliated with Reddit, X/Twitter, or the upstream CLI maintainers.

## Disclaimer

Reddix is provided "as is", without warranty of any kind, express or implied. To
the maximum extent permitted by applicable law, the authors, maintainers, and
contributors shall not be liable for any claim, damages, or other liability —
whether in contract, tort, or otherwise — arising from, out of, or in connection
with the software or its use. You alone are responsible for how you use Reddix
and the provider CLIs, including compliance with Reddit's and X/Twitter's Terms
of Service, API terms, developer policies, and all applicable laws, as well as
for safeguarding any credentials you supply. Reddix is an independent project and
is not affiliated with, endorsed by, or sponsored by Reddit, X/Twitter, or the
upstream CLI maintainers.

## License

MIT. See [LICENSE](LICENSE).
