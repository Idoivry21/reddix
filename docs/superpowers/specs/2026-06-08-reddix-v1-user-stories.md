# Reddix V1 User Stories

Date: 2026-06-08

## Scope

These user stories cover the whole Reddix V1 product: a local, single-user,
read-only research and export workbench for Reddit and X/Twitter data through
the separately installed `rdt` and `twitter` CLIs.

The primary user is a researcher, founder, analyst, developer advocate, or
operator who wants repeatable social research without typing CLI commands or
writing scripts. V1 is local-first, database-free, and read-only.

## Non-Goals Reflected In This Backlog

- No posting, commenting, voting, liking, retweeting, bookmarking, following, or
  any other authenticated write action.
- No hosted, team, multi-user, or multi-tenant mode.
- No bundled Reddit or X/Twitter CLIs.
- No database.
- No full mobile authoring; mobile is read-only monitoring.
- No deep automatic pagination beyond the bounded single-page source blocks in
  V1.

## Epic 1: Onboarding And Provider Health

### Story 1.1: Open Directly To A Useful Workbench

Priority: P0

As a first-time user, I want the app to open directly into a usable starter
flow so that I can understand the tool without building a graph from scratch.

Acceptance criteria:

- Given I open Reddix for the first time, when the app loads, then I see the
  canvas workbench rather than a marketing or landing page.
- Given no saved flow is selected, when the first screen appears, then the
  Weekly market digest starter flow is loaded with Reddit and X/Twitter
  branches.
- Given the starter flow is visible, when I inspect it, then it includes source,
  transform, merge, limit, and export blocks arranged in a readable
  left-to-right workflow.

### Story 1.2: See CLI Availability

Priority: P0

As a local user, I want to see whether `rdt` and `twitter` are installed so that
I know which blocks can run before I start debugging a flow.

Acceptance criteria:

- Given `rdt` is missing, when provider health loads, then Reddit health is
  shown as missing with setup guidance.
- Given `twitter` is missing, when provider health loads, then X/Twitter health
  is shown as missing with setup guidance.
- Given a provider CLI is missing, when I configure or run a flow requiring that
  provider, then the app identifies the missing provider as the blocker.
- Given one CLI is available and the other is missing, when I use the app, then
  the available provider remains usable.

### Story 1.3: Understand Auth Status Without Storing Secrets

Priority: P0

As a user running read-only research, I want to see provider auth status and
warnings so that I know when a block needs credentials without handing secrets
to the app UI.

Acceptance criteria:

- Given public Reddit read blocks can run without auth, when Reddit auth is
  absent, then the app does not block those public reads solely because auth is
  missing.
- Given an X/Twitter block requires auth, when auth is unavailable, then the app
  shows a warning scoped to that block or provider.
- Given auth tokens exist in the environment, when command previews, logs, and
  run records are rendered, then the secret values are redacted.

## Epic 2: Flow Creation And Canvas Editing

### Story 2.1: Discover Blocks From A Palette

Priority: P0

As a flow author, I want to browse and search available blocks so that I can
quickly find the source, transform, or output step I need.

Acceptance criteria:

- Given the workbench is open, when I look at the palette, then blocks are
  grouped by provider and category.
- Given I type in the palette search box, when matching blocks exist, then the
  palette narrows to those matches.
- Given a block is P0 or P1, when I view it in the palette, then its label and
  purpose are clear enough to distinguish it from adjacent blocks.

### Story 2.2: Add Blocks To The Canvas

Priority: P0

As a flow author, I want to drag blocks onto the canvas so that I can build a
research workflow visually.

Acceptance criteria:

- Given I drag a palette block onto the canvas, when I drop it in a valid
  location, then a node is created with default settings.
- Given I add a source, transform, or output node, when it appears on the
  canvas, then its provider/category and status are visually identifiable.
- Given a node is added, when I save and reload the flow, then its block type,
  label, position, and settings persist.

### Story 2.3: Connect Compatible Blocks

Priority: P0

As a flow author, I want to connect block ports only when their data types are
compatible so that invalid workflows are caught while I build.

Acceptance criteria:

- Given a source outputs `SocialItem[]`, when I connect it to a transform that
  accepts `SocialItem[]`, then the edge is accepted.
- Given a block output is incompatible with a target input, when I try to
  connect them, then the edge is rejected with a stated reason.
- Given an edge exists, when I save and reload the flow, then the connection is
  restored.

### Story 2.4: Navigate The Canvas

Priority: P0

As a flow author, I want to pan, zoom, and fit the graph to view so that I can
work with larger flows without losing orientation.

Acceptance criteria:

- Given a graph extends beyond the viewport, when I pan or zoom, then I can
  reach every node.
- Given the graph is off-center, when I use fit-to-view, then the visible graph
  is framed in the canvas.
- Given I move around the canvas, when I select a node, then the selection state
  remains clear.

### Story 2.5: Edit Nodes Efficiently

Priority: P0

As a frequent flow author, I want keyboard and bulk editing operations so that
I can revise workflows without repetitive manual rebuilding.

Acceptance criteria:

- Given one or more nodes are selected, when I delete them, then the nodes and
  dependent edges are removed.
- Given a node is selected, when I duplicate it, then a new node with matching
  settings is created at a nearby position.
- Given I make graph edits, when I use undo and redo, then add, move, connect,
  delete, and setting edits are reversed and restored in order.
- Given I select multiple nodes, when I move or delete them, then the operation
  applies to the selected set.

### Story 2.6: Monitor On Mobile Without Authoring

Priority: P1

As a user checking a flow from a small screen, I want a read-only mobile
experience so that I can monitor status without fighting a touch-based node
editor.

Acceptance criteria:

- Given I open the app on a mobile viewport, when the workbench loads, then
  graph authoring controls are disabled or withheld.
- Given I view a run on mobile, when logs or status are available, then I can
  inspect them without editing the graph.
- Given mobile authoring is unavailable, when I try to perform an authoring
  action, then the UI communicates that mobile is monitor/read-only in V1.

## Epic 3: Block Configuration And Graph Validation

### Story 3.1: Configure A Selected Block

Priority: P0

As a flow author, I want an inspector for the selected block so that I can set
queries, counts, filters, output formats, and other block-specific options.

Acceptance criteria:

- Given I select a node, when the inspector opens, then it shows fields for that
  node's block type.
- Given a field has a default value, when a new node is created, then the
  default is populated.
- Given I edit a field, when the setting is valid, then the node configuration
  updates without changing unrelated nodes.

### Story 3.2: Validate Required Settings

Priority: P0

As a flow author, I want invalid or incomplete settings flagged inline so that I
can fix the graph before running it.

Acceptance criteria:

- Given a required field is empty, when I inspect the block or try to run the
  flow, then the missing field is identified.
- Given a field has a max length, numeric bound, date format, or pattern, when I
  enter an invalid value, then validation reports the constraint.
- Given all required settings are valid, when I run validation, then the block
  does not produce a settings error.

### Story 3.3: Preview Generated Commands

Priority: P0

As a cautious local user, I want to preview the generated CLI command arguments
so that I can understand what Reddix will run.

Acceptance criteria:

- Given a CLI-backed block is selected, when settings are valid enough to build
  a preview, then the inspector shows the executable and argv-style arguments.
- Given a setting contains user-provided text, when the command preview is
  shown, then the text appears as an argument value rather than as a shell
  string.
- Given a command would include a secret, when the preview renders, then the
  secret is redacted.

### Story 3.4: Block Invalid Graph Runs

Priority: P0

As a user running research flows, I want the app to reject invalid graphs before
execution so that failures are clear and avoidable.

Acceptance criteria:

- Given the graph has a cycle, when I click Run Now, then the run is blocked and
  the cycle problem is reported.
- Given no output block is reachable from a source, when I click Run Now, then
  the run is blocked with a graph validation error.
- Given an edge references a missing node or port, when validation runs, then the
  invalid reference is reported.
- Given all required settings and graph rules pass, when I click Run Now, then
  execution can start.

## Epic 4: Manual Runs And Live Console Output

### Story 4.1: Run A Flow Manually

Priority: P0

As a researcher, I want to run a flow on demand so that I can collect current
social results when I need them.

Acceptance criteria:

- Given a valid flow exists, when I click Run Now, then the app persists the
  current flow state before execution.
- Given execution starts, when the backend runs CLI-backed blocks, then it uses
  allowlisted argv arrays with `shell: false`.
- Given the run completes successfully, when I inspect the console or output
  preview, then I can see the resulting data or artifact links.

### Story 4.2: See Step-Level Progress

Priority: P0

As a user waiting for a run, I want per-step statuses and live logs so that I
can tell what is running, completed, failed, or skipped.

Acceptance criteria:

- Given a run is active, when a step starts, then the corresponding node and
  console entry show an in-progress status.
- Given a step writes stdout or stderr, when logs stream, then the console
  updates through the SSE stream or fallback refresh.
- Given a step finishes, when its result is recorded, then the run record
  includes status, redacted command args, exit code, timing, stdout summary, and
  stderr where relevant.

### Story 4.3: Continue Independent Branches After Failure

Priority: P0

As a researcher running multi-branch flows, I want one failed branch not to
destroy unrelated results so that partial research can still produce value.

Acceptance criteria:

- Given a two-branch flow where one source fails, when continue-on-error is
  enabled, then downstream dependents of the failed source are skipped.
- Given an unrelated branch is still valid, when another branch fails, then the
  unrelated branch continues running.
- Given a run has partial failure, when the final run record is shown, then it
  clearly separates failed, skipped, and successful steps.

### Story 4.4: Support Fail-Fast Runs

Priority: P1

As a user who prefers strict run semantics, I want a fail-fast option so that a
flow stops immediately when any step fails.

Acceptance criteria:

- Given fail-fast is enabled, when a step fails, then no later pending steps run.
- Given fail-fast stops a run, when the run record is displayed, then the first
  failure is visible as the cause.
- Given fail-fast is disabled, when one branch fails, then the default
  continue-on-error behavior applies.

## Epic 5: Source Data, Normalized Social Data, And Transforms

### Story 5.1: Normalize Reddit Results

Priority: P0

As a flow author, I want Reddit payloads normalized into a shared item shape so
that downstream transforms and exports do not need provider-specific logic.

Acceptance criteria:

- Given `rdt` returns JSON or a `.data` envelope, when a Reddit source step
  completes, then the payload is unwrapped and normalized to `SocialItem[]`.
- Given Reddit fields are missing, when normalization runs, then absent fields
  become `null` rather than invented values.
- Given normalized Reddit items are exported, when I inspect them, then they
  include platform, source block ID, stable ID, URL, author, community, text,
  timestamps, engagement, media, links, and raw payload where available.

### Story 5.2: Normalize X/Twitter Results

Priority: P0

As a flow author, I want X/Twitter payloads normalized into the same item shape
as Reddit so that mixed-provider flows can be merged and exported.

Acceptance criteria:

- Given `twitter` returns JSON or a `.data` envelope, when an X/Twitter source
  step completes, then the payload is unwrapped and normalized to
  `SocialItem[]`.
- Given X/Twitter-specific engagement fields exist, when normalization runs,
  then replies, likes, retweets, bookmarks, and views are mapped when present.
- Given a field has no X/Twitter equivalent, when normalization runs, then it is
  represented as `null`.

### Story 5.3: Filter Text Locally

Priority: P0

As a researcher, I want to include or exclude items by text so that exports
focus on relevant conversations.

Acceptance criteria:

- Given a `SocialItem[]` input, when Filter Text has include terms, then only
  matching items pass through.
- Given Filter Text has exclude terms, when an item matches those terms, then it
  is removed.
- Given text is spread across title, body, community, author, or URL fields,
  when filtering runs, then the normalized searchable text is used consistently.

### Story 5.4: Filter By Engagement

Priority: P0

As a researcher, I want to filter by engagement thresholds so that low-signal
items can be removed before export.

Acceptance criteria:

- Given Reddit items include scores or comment counts, when engagement filters
  apply, then matching Reddit items pass and non-matching items are removed.
- Given X/Twitter items include likes, replies, retweets, bookmarks, or views,
  when engagement filters apply, then matching X/Twitter items pass and
  non-matching items are removed.
- Given a requested metric is absent for an item, when filtering runs, then the
  absence is handled predictably without crashing the run.

### Story 5.5: Merge, Sort, And Limit Streams

Priority: P1

As a user combining multiple sources, I want to merge, sort, and limit normalized
streams so that the final export is ordered and bounded.

Acceptance criteria:

- Given two or more compatible `SocialItem[]` inputs, when Merge Streams runs,
  then the output contains items from each input with provenance preserved.
- Given a merged stream, when Sort Local runs, then items are ordered by the
  selected supported field.
- Given a stream has more items than the Limit value, when Limit runs, then only
  the first configured number of items pass through.

### Story 5.6: Enrich Items With Detail Blocks

Priority: P1

As a researcher, I want optional detail blocks for posts, tweets, users, and
articles so that I can enrich a focused set of results when needed.

Acceptance criteria:

- Given a supported detail block is configured with a valid ID, handle, or URL,
  when it runs, then it calls the expected provider CLI command.
- Given detail output is normalized or passed through, when downstream blocks
  consume it, then incompatible connections are rejected.
- Given a detail command fails, when the run completes, then the failure is
  recorded at the detail step without hiding earlier source results.

### Story 5.7: Use Supported Source Blocks

Priority: P0/P1

As a researcher, I want source blocks for the supported Reddit and X/Twitter
read-only commands so that I can build flows around the social surface I need.

Acceptance criteria:

- Given I need Reddit search results, when I configure Search Reddit, then I can
  provide query, subreddit, sort, time range, and result count settings.
- Given I need additional Reddit listings, when I use P1 Reddit source blocks,
  then Browse Subreddit and Popular / All expose the supported read-only listing
  settings.
- Given I need X/Twitter search results, when I configure Search Tweets, then I
  can provide query, tab, max count, language, from-user, since date, retweet,
  link, and full-text settings.
- Given I need additional X/Twitter reads, when I use P1 X/Twitter source
  blocks, then Timeline Feed, Bookmarks, User Tweets, and List Timeline expose
  their supported read-only settings.
- Given any source block runs successfully, when it returns provider JSON, then
  downstream blocks receive normalized `SocialItem[]` output.

## Epic 6: Export Artifacts And Reports

### Story 6.1: Export JSON

Priority: P0

As a researcher, I want to export normalized results as JSON so that I can use
the data in scripts, notebooks, or other tools.

Acceptance criteria:

- Given an output JSON block receives `SocialItem[]`, when it runs, then a JSON
  artifact is written under the configured local artifacts directory.
- Given repeated runs produce JSON exports, when filenames are generated, then
  earlier files are not overwritten.
- Given the run finishes, when I inspect output files, then the resolved JSON
  path is visible.

### Story 6.2: Export CSV

Priority: P0

As a researcher, I want to export normalized results as CSV so that I can open
them in spreadsheets and analysis tools.

Acceptance criteria:

- Given an output CSV block receives `SocialItem[]`, when it runs, then a CSV
  artifact is written under the artifacts directory.
- Given item text contains commas, quotes, or newlines, when CSV is written,
  then fields are escaped correctly.
- Given repeated runs produce CSV exports, when filenames are generated, then
  earlier files are not overwritten.

### Story 6.3: Export Markdown

Priority: P1

As a researcher creating a digest, I want a Markdown export so that I can read,
share, or edit the results as a plain-text report.

Acceptance criteria:

- Given a Markdown output block receives results, when it runs, then a Markdown
  artifact is written.
- Given results include multiple platforms, when Markdown is generated, then the
  output remains readable and keeps provider context.
- Given item fields are missing, when Markdown is generated, then the report
  omits or labels missing fields cleanly.

### Story 6.4: Export A Self-Contained HTML Report

Priority: P1

As a researcher, I want an HTML report link after a run so that I can inspect a
polished digest in the browser.

Acceptance criteria:

- Given an HTML output block receives results, when it runs, then a
  self-contained HTML report is written.
- Given the report exists, when the run output is shown, then an Open report link
  is available through the local artifact route.
- Given fetched social content contains HTML-like text, when the report renders,
  then content is escaped and cannot execute scripts.
- Given links appear in fetched content, when the report renders them, then only
  `http` and `https` links are allowed.

### Story 6.5: Keep Artifacts Contained

Priority: P0

As a local user, I want export paths constrained to the app data directory so
that artifacts cannot write or serve files outside the intended location.

Acceptance criteria:

- Given an export path tries to traverse outside the artifacts directory, when
  the export path is resolved, then the write is rejected.
- Given an artifact request tries path traversal, when the API resolves it, then
  the request is rejected.
- Given a served HTML report is returned, when the browser receives it, then it
  includes defensive headers such as `nosniff` and a tight content security
  policy.

## Epic 7: Scheduling And Run History

### Story 7.1: Configure A Local Schedule

Priority: P0

As a user tracking recurring topics, I want to schedule a flow locally so that
Reddix can refresh research while the backend is running.

Acceptance criteria:

- Given I open the schedule controls for a saved flow, when I choose an interval
  schedule, then the app stores the schedule with the flow.
- Given the chosen interval is below the minimum allowed interval, when I save
  the schedule, then the app rejects or corrects it with an explanation.
- Given a schedule is active, when I view it, then I can see the next run time.

### Story 7.2: Pause And Resume A Schedule

Priority: P0

As a local user, I want to pause and resume scheduled runs so that I can control
when background research happens.

Acceptance criteria:

- Given a schedule is active, when I pause it, then future ticks do not start new
  runs.
- Given a schedule is paused, when I resume it, then the next run time is
  recalculated.
- Given a schedule state changes, when I reload the app, then the saved schedule
  state is restored.

### Story 7.3: Prevent Overlapping Runs

Priority: P0

As a user protecting accounts and local resources, I want overlapping runs of
the same flow to be skipped so that a scheduled flow never fans out concurrent
CLI calls.

Acceptance criteria:

- Given a flow is already running, when a manual or scheduled trigger for the
  same flow occurs, then the second trigger is skipped rather than queued or run
  concurrently.
- Given a scheduled tick is skipped due to overlap, when run history is viewed,
  then the skip is recorded.
- Given different providers are used in a flow, when provider steps execute,
  then per-provider spacing or serialization prevents bursts beyond the CLIs'
  own throttling.

### Story 7.4: Review Run History

Priority: P0

As a researcher, I want to review prior runs so that I can audit what happened
and reopen generated artifacts.

Acceptance criteria:

- Given a flow has completed runs, when I open run history, then I can see recent
  runs with status, timing, and output files.
- Given a run failed, when I inspect it, then the failing step, redacted command,
  exit code, and stderr are visible.
- Given run history exceeds the retention cap, when new runs are recorded, then
  older runs are pruned according to the local retention policy.

## Epic 8: Persistence And Local Data Safety

### Story 8.1: Save And Reload Flows

Priority: P0

As a local user, I want saved flows to reload exactly so that my work survives
app restarts.

Acceptance criteria:

- Given I save a flow, when I restart the app and reload it, then nodes, edges,
  positions, settings, schedule, and flow metadata are restored.
- Given a flow has a schema version, when it is loaded, then the app handles the
  version through the migration path.
- Given flow JSON is invalid or corrupted, when loading fails, then the app shows
  an actionable error instead of crashing.

### Story 8.2: Store Data Locally Without A Database

Priority: P0

As a local-first user, I want flows, runs, preferences, and artifacts stored as
local files so that the app remains simple and inspectable.

Acceptance criteria:

- Given `REDDIX_DATA_DIR` is configured, when the backend starts, then local JSON
  storage and artifact paths resolve under that directory.
- Given preferences are saved, when the app restarts, then selected flow and
  relevant defaults are restored.
- Given no database is configured, when the app runs, then all V1 persistence
  still works.

### Story 8.3: Migrate Persisted Records

Priority: P1

As a pre-1.0 user, I want old local records to migrate safely so that expected
format changes do not silently lose my flows.

Acceptance criteria:

- Given a supported older schema version exists, when the record loads, then it
  is upgraded to the current shape.
- Given an unsupported or malformed record exists, when the record loads, then
  the app reports the issue clearly.
- Given migration succeeds, when the record is saved again, then it uses the
  current schema version.

## Epic 9: Error Handling And Recovery

### Story 9.1: Missing CLI Errors Are Actionable

Priority: P0

As a user, I want missing CLI errors to tell me what is missing so that I can
install or fix the right provider.

Acceptance criteria:

- Given a Reddit block is in a flow and `rdt` is missing, when the block would
  run, then the step fails with a Reddit-specific missing CLI error.
- Given an X/Twitter block is in a flow and `twitter` is missing, when the block
  would run, then the step fails with an X/Twitter-specific missing CLI error.
- Given a CLI is missing, when another branch does not require that provider,
  then the unrelated branch can still run under continue-on-error.

### Story 9.2: Command Failures Preserve Diagnostics

Priority: P0

As a user debugging a flow, I want command failures to preserve stderr, exit
code, and redacted argv so that I can understand what failed.

Acceptance criteria:

- Given a CLI exits non-zero, when the run record is created, then it includes
  the exit code and stderr.
- Given a command fails, when the console displays the failure, then it shows the
  redacted command arguments.
- Given the command included sensitive environment-derived values, when failure
  diagnostics are shown, then those values are absent.

### Story 9.3: Parse Failures Show Raw Output Safely

Priority: P0

As a user diagnosing provider output issues, I want parse failures to show enough
raw output to debug without hiding the failure.

Acceptance criteria:

- Given a CLI returns invalid JSON, when parsing fails, then the step is marked
  failed.
- Given parsing fails, when the console renders diagnostics, then it includes a
  bounded raw output preview.
- Given raw output contains secret-like values, when diagnostics are rendered,
  then redaction still applies.

### Story 9.4: Structured Provider Errors Are Surfaced

Priority: P1

As a user, I want provider-specific errors like auth, rate limit, not found, or
invalid input to be visible so that I can respond appropriately.

Acceptance criteria:

- Given a provider returns `not_authenticated`, when the step fails, then the UI
  shows an auth-related error.
- Given a provider returns `rate_limited`, when the step fails or backs off,
  then the UI shows that rate limiting was the cause.
- Given a provider returns `not_found`, `invalid_input`, or `api_error`, when
  the step fails, then the code or category is preserved in the run details.

## Epic 10: Security And Read-Only Guarantees

### Story 10.1: Never Build Shell Strings

Priority: P0

As a security-conscious user, I want all commands built as argv arrays so that
query text cannot become shell syntax.

Acceptance criteria:

- Given user input contains shell metacharacters, when a command is built, then
  the input remains a single argv value.
- Given a CLI command runs, when the executor spawns it, then `shell: false` is
  used.
- Given a new block is added, when its command builder is tested, then it proves
  the command is allowlisted and argv-based.

### Story 10.2: Never Leak Secrets

Priority: P0

As a user with local auth configured, I want secrets redacted everywhere so that
tokens cannot be exposed through the UI, logs, or persisted records.

Acceptance criteria:

- Given `TWITTER_AUTH_TOKEN` or `TWITTER_CT0` is set, when a Twitter command
  runs, then the values are absent from command previews.
- Given a run record is saved, when it is inspected, then secret values are
  absent from stored command args, stdout summaries, stderr, and errors.
- Given SSE logs stream during a run, when logs are displayed, then secret values
  are redacted before they reach the client.

### Story 10.3: Preserve Read-Only Scope

Priority: P0

As a user, I want V1 to prevent write actions so that Reddix cannot accidentally
post, vote, like, retweet, bookmark, follow, or otherwise mutate social
accounts.

Acceptance criteria:

- Given the block registry is loaded, when I inspect available blocks, then no
  authenticated write-action blocks are present.
- Given a flow JSON contains an unsupported write-action block type, when the
  flow is validated or run, then the block is rejected.
- Given auth is available, when read-only blocks run, then auth does not expand
  the UI into write capabilities.

### Story 10.4: Keep Localhost Protected

Priority: P0

As a local user, I want same-origin and request protections so that another site
cannot drive my local Reddix backend.

Acceptance criteria:

- Given a mutating request comes from a disallowed origin, when the backend
  receives it, then CORS or CSRF protection rejects it.
- Given a safe local frontend origin sends a request, when the backend receives
  it, then the request is allowed.
- Given repeated run requests exceed the rate limit, when the backend receives
  them, then `/runs` is rate-limited.

### Story 10.5: Respect Provider Throttling

Priority: P0

As a user relying on external CLIs, I want Reddix to avoid out-running their own
rate limits so that my accounts and IP reputation are protected.

Acceptance criteria:

- Given schedules are configured, when intervals are saved, then they obey the
  minimum schedule interval and jitter rules.
- Given multiple steps hit the same provider, when they execute, then provider
  spacing or serialization prevents parallel bursts.
- Given a rate-limit response occurs, when the app handles it, then it applies
  backoff or records the rate-limit condition rather than immediately hammering
  the provider.

## Epic 11: Product-Level Acceptance

### Story 11.1: Complete The Core Research Loop

Priority: P0

As a researcher, I want to create, run, inspect, and export a dual-provider flow
so that Reddix delivers its core value end to end.

Acceptance criteria:

- Given I start from the starter flow, when I update the Reddit and X/Twitter
  queries, run the flow, and export results, then I can complete the workflow
  without typing CLI commands manually.
- Given both provider CLIs are available, when the starter flow runs, then
  Reddit and X/Twitter source data can flow through transforms into JSON and CSV
  outputs.
- Given the run produces artifacts, when I inspect the run output, then artifact
  paths or links are visible.

### Story 11.2: Explain Failures Without Expert Knowledge

Priority: P0

As a non-expert CLI user, I want failures translated into concrete UI feedback
so that I can decide whether to install a CLI, fix auth, adjust settings, or
retry later.

Acceptance criteria:

- Given a flow fails because of missing setup, invalid settings, command failure,
  parse failure, auth failure, rate limit, or graph invalidity, when the error is
  shown, then it names the category and affected step.
- Given an error is recoverable by changing settings, when it is shown, then it
  points to the setting or block that needs attention.
- Given an error is external to Reddix, when it is shown, then the app preserves
  enough CLI diagnostics to troubleshoot without exposing secrets.
