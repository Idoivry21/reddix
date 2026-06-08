# Test Coverage Gap Audit — Reddix

**Date:** 2026-06-08  ·  **Branch:** main  ·  **Method:** 14 parallel domain analyzers → adversarial verification pass (skeptic re-greps the whole `tests/` suite to refute each "untested" claim).

## Summary

| Metric | Value |
|---|---|
| Domains analyzed | 14 |
| Raw findings | 110 |
| **Confirmed gaps** | **106** |
| Refuted (auditor wrong — actually covered) | 4 |

**Confirmed by severity:** Critical 2 · High 52 · Medium 37 · Low 15

> Every gap below carries: production excerpt (verbatim), the closest existing test (if any), the grep evidence used to confirm absence, and an adversarial-verify verdict. Findings the verify pass overturned are listed under "Refuted" and are **not** reported as gaps.

## Refuted findings (NOT gaps — verifier found covering tests)

- **sampleItemToSocialItem** @ `server/runEngine.ts` — covered: The function is called at line 346 in runSingleNode and tested indirectly through cached-upstream mode tests in runSingleNode.test.ts:45-63 ('feeds cached upstream samples into a fan-out enrichment node') and lines 65-78. These tests construct RunStepSampleItem objects with normal engagement objects and verify the cached-upstream flow works correctly.
- **safeHref** @ `src/shared/urlSafety.ts` — covered: Tests at lines 38-58 of /Users/ido/Documents/reddix/tests/htmlReport.test.ts cover file://, protocol-relative, and case-variation attacks. Line 46 tests 'data:text/html,...' demonstrating dangerous schemes are blocked. Line 45 tests 'javascript:alert(1)'. URL constructor (used at line 11 of urlSafety.ts) normalizes protocols to lowercase per ECMAScript spec, so JAVASCRIPT: becomes javascript: and is correctly filtered. Protocol-relative URLs like '//example.com' throw Invalid URL exception (caught by catch block at line 18) and return null. File:// URLs parse successfully but are filtered by the protocol check at lines 12-14 (not http: or https:). All XSS vectors mentioned in claim are actually covered through the protocol validation mechanism.
- **tryAcquire** @ `server/rateLimiter.ts` — covered: /Users/ido/Documents/reddix/tests/rateLimiter.test.ts, lines 19-25: 'allows again once the window elapses' test. At t=1000 first acquire (stores 1000), at t=3000 second acquire with minIntervalMs=2000. The difference 3000-1000=2000 exactly equals minIntervalMs, making the condition (at - previous < minIntervalMs) evaluate to (2000 < 2000) = false, allowing acquisition. This IS the exact boundary condition being tested.
- **Inspector field-hint upstream binding display** @ `src/components/Inspector.tsx` — covered: Inspector.test.tsx includes two tests that verify the exact behavior claimed: (1) 'hints that a blank input-bound field fans out over upstream items' (line 31-34) tests that showUpstreamHint appears when isInputBound=true and value is blank; (2) 'hides the upstream hint once the bound field has a static value' (line 36-39) tests that the hint is hidden when tweetIdOrUrl has a value ('12345'). Additionally, line 109-116 tests binding policy buttons: 'defaults the skip policy to skip and emits __bindPolicy on change' verifies that the skip button shows aria-pressed='true' by default and that clicking 'fail node' button emits __bindPolicy change.

---

## Critical gaps (2)

### 1. shutdown  
`server/index.ts` · **CRITICAL** · confidence high · observability-lifecycle

**Uncovered behavior:** The shutdown() function in index.ts is never tested. No tests verify: (1) graceful shutdown orchestration (closeClients, killAllCliChildren, closeServer sequence), (2) SHUTDOWN_FORCE_EXIT_MS timeout behavior, (3) re-entrancy guard (shuttingDown flag), (4) correct exitCode propagation.

**Why it matters:** Critical production code path. If shutdown doesn't properly clean up connections, kill child processes, or timeout, the server hangs on graceful restart. The force-exit failsafe is untested, so a stalled closeServer could hang indefinitely if the timer doesn't work.

**Production code:**
```
function shutdown(reason: string, exitCode = 0): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`[reddix] shutting down (${reason})`);
  closeClients();
  killAllCliChildren('SIGTERM');
  closeServer(server, () => {
    process.exit(exitCode);
  });
  // Failsafe: force exit if the server does not close in time.
  const timer = setTimeout(() => process.exit(exitCode), SHUTDOWN_FORCE_EXIT_MS);
  timer.unref();
}
```
**Existing test** (`tests/serverLifecycle.test.ts`):
```
(no excerpt)
```
**Suggested test:** integration

**Example cases:**
- shutdown calls closeClients, killAllCliChildren, closeServer in order
- shutdown(reason, exitCode) passes exitCode to process.exit
- shutdown re-entrancy: second call returns early without re-executing
- force-exit timer fires after SHUTDOWN_FORCE_EXIT_MS if closeServer stalls

**Mocks/fixtures/setup:** Mock process.exit, setTimeout/clearTimeout, closeClients, killAllCliChildren, closeServer, http.Server

**Verification evidence:** grep -r 'shutdown\|SHUTDOWN_FORCE_EXIT' /Users/ido/Documents/reddix/tests --include='*.test.ts' found zero actual tests of shutdown(). grep -r 'from.*index.ts\|import.*shutdown\|from.*server/index' /Users/ido/Documents/reddix/tests --include='*.test.ts' returned zero results. The shutdown function (lines 48-62 of index.ts) is never imported or tested. No verification of: graceful shutdown orchestration (closeClients, killAllCliChildren, closeServer sequence), SHUTDOWN_FORCE_EXIT_MS timeout behavior (line 60-61), re-entrancy guard (shuttingDown flag), or exitCode propagation.

---

### 2. process signal handlers (SIGTERM, SIGINT, uncaughtException, unhandledRejection)  
`server/index.ts` · **CRITICAL** · confidence high · observability-lifecycle

**Uncovered behavior:** All four process event handlers are never tested. No test verifies: signal handlers are registered, callbacks invoke shutdown with correct reason, fatal errors are formatted/redacted, exitCode=1 is passed for exceptions/rejections.

**Why it matters:** Critical lifecycle events that trigger graceful shutdown. If SIGTERM/SIGINT handlers aren't registered, the process won't shut down cleanly on container termination. If fatal handlers don't call shutdown, the process hangs. If formatFatalReason doesn't redact, secrets leak to console.

**Production code:**
```
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  console.error('[reddix] uncaughtException:', formatFatalReason(error));
  shutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[reddix] unhandledRejection:', formatFatalReason(reason));
  shutdown('unhandledRejection', 1);
});
```
**Existing test:** none.
**Suggested test:** integration

**Example cases:**
- SIGTERM triggers shutdown('SIGTERM') with exitCode=0
- SIGINT triggers shutdown('SIGINT') with exitCode=0
- uncaughtException calls formatFatalReason and shutdown(..., 1)
- unhandledRejection calls formatFatalReason and shutdown(..., 1)

**Mocks/fixtures/setup:** Mock process.on, process.exit, shutdown function, formatFatalReason, console.error; simulate emitting signals or exceptions

**Verification evidence:** grep -r 'SIGTERM\|SIGINT\|uncaughtException\|unhandledRejection' /Users/ido/Documents/reddix/tests --include='*.test.ts' found only: /Users/ido/Documents/reddix/tests/schedulerResilience.test.ts:// an unhandledRejection in the real `void tick()` and kill the server). (line comment only, not a test). Zero actual tests exist. The process.on() calls at lines 64-65 and 67-75 of index.ts are never tested. No verification that signal handlers are registered or that shutdown is invoked with correct reason and exitCode.

---

## High gaps (52)

### 3. createErrorHandler  
`server/errorHandler.ts` · **HIGH** · confidence high · api-routes

**Uncovered behavior:** Error middleware never tested: (1) does not catch and serialize unhandled route errors to JSON with requestId, (2) error envelope shape (status 500, code INTERNAL_ERROR, requestId) never verified, (3) error redaction (secrets not leaking) never validated, (4) response-already-sent edge case (next(error)) never tested, (5) non-Error object handling never tested.

**Why it matters:** Critical business logic. Unhandled errors in routes should return safe JSON with requestId for support tracking. If the middleware fails silently, Express default error handler leaks stack traces; if requestId correlation is missing, users cannot report 500s. This is the last line of defense for API error safety.

**Production code:**
```
export function createErrorHandler(logger: Pick<EventLogger, 'error'>): ErrorRequestHandler {
  return (error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    const requestId = nanoid();
    logger.error('request error', {
      requestId,
      path: request.path,
      detail: error instanceof Error ? error.message : String(error)
    });
    response.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR', requestId });
  };
}
```
**Existing test:** none.
**Suggested test:** integration

**Example cases:**
- POST /api/runs with storage error: expect 500 + INTERNAL_ERROR + requestId
- GET /api/health with logger.error stubbed: verify error logged with path, detail, requestId
- Route throws Error: expect JSON response (not HTML stack trace)
- Route throws non-Error object: expect serialized to String safely

**Mocks/fixtures/setup:** Mock Express app with routes that throw, integration test using createApp(), mocked logger.error to capture calls, HTTP server listening on test port

**Verification evidence:** grep -r 'createErrorHandler|errorHandler|ErrorHandler' /Users/ido/Documents/reddix/tests --include='*.test.ts' => (no results); grep -r 'INTERNAL_ERROR|requestId' /Users/ido/Documents/reddix/tests --include='*.test.ts' => (no results). The error handler exists at /Users/ido/Documents/reddix/server/errorHandler.ts lines 11-27 and is mounted in /Users/ido/Documents/reddix/server/app.ts line 75, but no tests exist for it. No HTTP-level tests verify the 500 response, requestId correlation, or error serialization.

---

### 4. GET /api/runs/:flowId  
`server/routes.ts` · **HIGH** · confidence high · api-routes

**Uncovered behavior:** HTTP endpoint GET /api/runs/:flowId under-tested: (1) INVALID_FLOW_ID (unsafe flowId like '../../' or '/' ) never tested—ensureSafeFlowId protection not verified at HTTP level, (2) non-existent flowId returns 200 with empty array—no 404 test, (3) response shape (runs array) not verified, (4) error path ensureSafeFlowId not tested (should 400).

**Why it matters:** High risk. Path safety validation (ensureSafeFlowId) is critical but only tested at utility level. HTTP-level test gap means path traversal could silently become possible if safeId check is removed. Also, 404 behavior is unspecified—API could return empty array for non-existent flows, confusing clients.

**Production code:**
```
  router.get('/runs/:flowId', async (request, response) => {
    if (!ensureSafeFlowId(request, response)) {
      return;
    }
    response.json({ runs: await options.storage.listRuns(request.params.flowId) });
  });
```
**Existing test** (`tests/runNodeRoute.test.ts`):
```
const history = (await (await fetch(`${base}/api/runs/flow-1`)).json()) as { runs: unknown[] };
    expect(history.runs).toEqual([]);
```
**Suggested test:** integration

**Example cases:**
- GET /api/runs/flow-1 with empty history returns { runs: [] }
- GET /api/runs/flow-1 with 2 prior runs returns { runs: [run1, run2] }
- GET /api/runs/invalid%2fid (path traversal) returns 400 with INVALID_FLOW_ID
- GET /api/runs/nonexistent-flow returns 404 or { runs: [] } (spec unclear)

**Mocks/fixtures/setup:** HTTP server, createStorage with test flows and runs, fetch GET /api/runs/:flowId, test both valid and unsafe flowId values

**Verification evidence:** grep -r 'fetch.*api/runs' /Users/ido/Documents/reddix/tests --include='*.test.ts' => only line 108 in runNodeRoute.test.ts: `const history = (await (await fetch('${base}/api/runs/flow-1')).json()) as { runs: unknown[] };` This is a single integration test that only checks { runs } structure, not HTTP status, and does not test (1) path traversal rejection, (2) non-existent flowId behavior, (3) empty array case. The ensureSafeFlowId guard at /Users/ido/Documents/reddix/server/routes.ts lines 302-305 is never tested at the HTTP level.

---

### 5. POST /api/schedules/:flowId/trigger  
`server/routes.ts` · **HIGH** · confidence high · api-routes

**Uncovered behavior:** HTTP endpoint POST /api/schedules/:flowId/trigger never tested: (1) success path (triggers and returns run) not tested, (2) SCHEDULE_NOT_DUE 429 response never verified, (3) details.nextRunAt ISO format never checked, (4) flow not found 404 never tested, (5) unsafe flowId 400 INVALID_FLOW_ID never tested. Scheduler.triggerDue() is unit-tested, but the HTTP route is untested.

**Why it matters:** Critical scheduling feature. Manual schedule trigger is a key user workflow. Missing tests mean (1) if SCHEDULE_NOT_DUE response structure changes, clients break silently, (2) if nextRunAt format becomes invalid ISO, clients fail parsing, (3) path traversal vulnerabilities hide.

**Production code:**
```
  router.post('/schedules/:flowId/trigger', async (request, response) => {
    if (!ensureSafeFlowId(request, response)) {
      return;
    }
    const flow = await options.storage.getFlow(request.params.flowId);
    if (!flow) {
      response.status(404).json({ error: 'Flow not found' });
      return;
    }
    if (!flow.schedule?.enabled || scheduler.getNextRunAt(flow.id) === null) {
      syncSchedule(flow);
    }
    const result = await scheduler.triggerDue(request.params.flowId);
    if (!result.triggered) {
      response.status(429).json({
        error: 'Schedule is not due yet',
        code: 'SCHEDULE_NOT_DUE',
        details: { nextRunAt: result.nextRunAt ? new Date(result.nextRunAt).toISOString() : null }
      });
      return;
    }
    const run = result.result as RunRecord;
    respondWithRun(response, run);
  });
```
**Existing test:** none.
**Suggested test:** integration

**Example cases:**
- POST /api/schedules/flow-1/trigger when flow has enabled schedule: returns 200 + run record
- POST /api/schedules/flow-1/trigger when schedule not yet due: returns 429 + SCHEDULE_NOT_DUE + valid ISO nextRunAt
- POST /api/schedules/invalid%2fid/trigger: returns 400 with INVALID_FLOW_ID
- POST /api/schedules/nonexistent/trigger: returns 404 with 'Flow not found'

**Mocks/fixtures/setup:** HTTP server, createApp() with mocked scheduler.triggerDue() returning both {triggered: true, result: runRecord} and {triggered: false, nextRunAt: timestamp}, test flows with enabled/disabled schedules

**Verification evidence:** grep -r 'schedules.*trigger|/api/schedules|POST.*schedules' /Users/ido/Documents/reddix/tests --include='*.test.ts' => (no results); grep -r 'SCHEDULE_NOT_DUE' /Users/ido/Documents/reddix/tests --include='*.test.ts' => (no results). The endpoint exists at /Users/ido/Documents/reddix/server/routes.ts lines 338-361 but zero HTTP tests exist. No tests verify success path, 429 SCHEDULE_NOT_DUE response, nextRunAt ISO format, 404 for missing flow, or 400 INVALID_FLOW_ID for unsafe flowId. Scheduler.triggerDue() is unit-tested but not the HTTP route.

---

### 6. ensureSafeFlowId  
`server/routes.ts` · **HIGH** · confidence high · api-routes

**Uncovered behavior:** HTTP 400 INVALID_FLOW_ID response from ensureSafeFlowId never tested: (1) path traversal attempts (../, ../../etc/passwd) never return 400 in HTTP tests, (2) response.json() shape never verified (code: 'INVALID_FLOW_ID'), (3) used in GET /flows/:id, PUT /flows/:id, GET /runs/:id, POST /schedules/:id/trigger routes—none test the 400 path. isSafeId() utility is unit-tested, but the route-level guard is not.

**Why it matters:** Security boundary. This guard prevents path traversal attacks on file operations. If a developer removes this guard or breaks its integration, file access could escape the dataDir. HTTP-level tests are necessary to ensure the guard's integration is correct.

**Production code:**
```
function ensureSafeFlowId(request: Request, response: Response): boolean {
  if (!isSafeId(request.params.flowId)) {
    response.status(400).json({ error: 'Invalid flow id', code: 'INVALID_FLOW_ID' });
    return false;
  }
  return true;
}
```
**Existing test** (`tests/safeId.test.ts`):
```
for (const id of invalid) {
      expect(isSafeId(id)).toBe(false);
      expect(() => assertSafeId(id)).toThrow(/invalid id/i);
    }
```
**Suggested test:** integration

**Example cases:**
- GET /api/flows/..%2fsecret (path traversal): returns 400 with INVALID_FLOW_ID
- PUT /api/flows/x/../y: returns 400 with INVALID_FLOW_ID
- POST /api/schedules//double/slash/trigger: returns 400 with code=INVALID_FLOW_ID
- GET /api/runs/%00null (null byte): returns 400 with INVALID_FLOW_ID

**Mocks/fixtures/setup:** HTTP server with createApp(), fetch GET/PUT/POST to routes with unsafe flowId params, assert status 400 and response.code === 'INVALID_FLOW_ID'

**Verification evidence:** grep -r 'INVALID_FLOW_ID' /Users/ido/Documents/reddix/tests --include='*.test.ts' => (no results); grep -r 'ensureSafeFlowId' /Users/ido/Documents/reddix/tests --include='*.test.ts' => (no results). The function exists at /Users/ido/Documents/reddix/server/routes.ts lines 42-48 and is used in GET /flows/:flowId (line 251), PUT /flows/:flowId (line 263), GET /runs/:flowId (line 303), and POST /schedules/:flowId/trigger (line 339). The underlying isSafeId() utility is unit-tested in /Users/ido/Documents/reddix/tests/safeId.test.ts, but the HTTP 400 INVALID_FLOW_ID response is never verified at any endpoint.

---

### 7. POST /api/runs rate-limit + validation  
`server/routes.ts` · **HIGH** · confidence high · api-routes

**Uncovered behavior:** POST /api/runs missing critical test cases: (1) missing flowId in body—validation should 400 VALIDATION_FAILED but never tested, (2) empty body {}—should 400, never tested, (3) flowId present but nodeId without mode—should 400, never tested, (4) rate limit response body (code, error string) never verified, (5) run_rate_limited_total metric never verified. Node-run rate limiting is tested, but full-flow run rate limiting and validation edge cases are not.

**Why it matters:** High. Validation gaps mean malformed requests could crash or misbehave. Rate limit envelope (code: RATE_LIMITED) is API contract—clients parse this. If code changes to 'TOO_MANY_REQUESTS', frontend breaks silently. Full-flow rate limiting is security-critical (prevents account abuse/spam).

**Production code:**
```
  router.post('/runs', async (request, response) => {
    const parsed = parseRunPostBody(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: `Invalid run request: ${formatZodError(parsed.error)}`,
        code: 'VALIDATION_FAILED'
      });
      return;
    }
    const { flowId, nodeId, mode } = parsed.data;
    const rateKey = nodeId ? `${flowId}::${nodeId}` : flowId;
    if (!runRateLimiter.tryAcquire(rateKey)) {
      metrics.increment('run_rate_limited_total');
      logger?.warn('run.rateLimited', { flowId, nodeId: nodeId ?? null });
      response.status(429).json({
        error: 'Too many runs for this flow; please wait before retrying',
        code: 'RATE_LIMITED'
      });
      return;
    }
```
**Existing test** (`tests/runNodeRoute.test.ts`):
```
it('rate-limits per node in a separate bucket from full-flow runs', async () => {
    const base = await start(redditExecutor, 60_000);
    await putFlow(base);

    expect((await postJson(base, { flowId: 'flow-1', nodeId: 'search', mode: 'static' })).status).toBe(200);
    // Same node bucket is now throttled.
    expect((await postJson(base, { flowId: 'flow-1', nodeId: 'search', mode: 'static' })).status).toBe(429);
    // A full-flow run uses a different bucket and is still allowed.
    expect((await postJson(base, { flowId: 'flow-1' })).status).toBe(200);
  });
```
**Suggested test:** integration

**Example cases:**
- POST /api/runs {} (missing flowId): returns 400 with VALIDATION_FAILED
- POST /api/runs { flowId: 'f', nodeId: 'n' } (mode missing): returns 400 with VALIDATION_FAILED
- POST /api/runs { flowId: 'f' } (full-flow run): first succeeds 200, second returns 429 with RATE_LIMITED
- POST /api/runs rate-limited: response includes code: 'RATE_LIMITED' and error message

**Mocks/fixtures/setup:** HTTP server with createRoutes({ runMinIntervalMs: 1000 }), postJson() helper, createStorage with test flow

**Verification evidence:** grep -r 'VALIDATION_FAILED|RATE_LIMITED' /Users/ido/Documents/reddix/tests --include='*.test.ts' => (no results for missing flowId validation). The endpoint exists at /Users/ido/Documents/reddix/server/routes.ts lines 309-336. runNodeRoute.test.ts only tests single-node runs (lines 119-128) with rate limiting, not full-flow runs. No tests verify (1) missing flowId validation, (2) empty body {}, (3) nodeId without mode, (4) full-flow run rate limit response body structure, or (5) run_rate_limited_total metric. The schemas.test.ts validates at the schema layer (line 116) but HTTP endpoint validation is untested.

---

### 8. PUT /flows/:flowId validation  
`server/routes.ts` · **HIGH** · confidence high · api-routes

**Uncovered behavior:** PUT /api/flows/:flowId under-tested: (1) unsafe flowId (path traversal) never returns 400 INVALID_FLOW_ID, (2) empty/malformed body {}—should 400 VALIDATION_FAILED, not tested, (3) schedule.intervalMs out of bounds—should 400, never tested at HTTP level, (4) invalid flow graph (missing required edges)—INVALID_FLOW_GRAPH response never verified, (5) response shape (includes flow) never verified, (6) createdAt fallback (now if not provided) never verified, (7) scheduleInterval fallback (MIN_SCHEDULE_INTERVAL_MS if undefined) never tested.

**Why it matters:** High. PUT is the main flow editor endpoint. Missing tests mean (1) graph validation failures silently return different status codes than expected, (2) schedule edge cases (zero, negative, too-large intervals) could bypass validation, (3) if INVALID_FLOW_GRAPH code changes, frontend breaks, (4) createdAt behavior could regress (timestamp overwritten on edit).

**Production code:**
```
  router.put('/flows/:flowId', async (request, response) => {
    if (!ensureSafeFlowId(request, response)) {
      return;
    }
    const parsed = parseFlowPutBody(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: `Invalid flow body: ${formatZodError(parsed.error)}`,
        code: 'VALIDATION_FAILED'
      });
      return;
    }
    const incoming = parsed.data.flow;
    const now = new Date().toISOString();
    const flow: PersistedFlow = {
      schemaVersion: 1,
      id: request.params.flowId,
      name: incoming.name ?? 'Untitled Flow',
      failFast: incoming.failFast ?? false,
      nodes: incoming.nodes,
      edges: incoming.edges,
      nodePositions: incoming.nodePositions,
      blockSettings: incoming.blockSettings,
      schedule: incoming.schedule,
      createdAt: incoming.createdAt ?? now,
      updatedAt: now
    };
    const validation = validateFlow(flow);
    if (!validation.valid) {
      response.status(400).json({
        error: `Invalid flow graph: ${validation.errors.map((error) => `${error.nodeId}: ${error.message}`).join('; ')}`,
        code: 'INVALID_FLOW_GRAPH'
      });
      return;
    }
    await options.storage.saveFlow(flow);
    syncSchedule(flow);
    response.json({ flow });
  });
```
**Existing test** (`tests/runNodeRoute.test.ts`):
```
const response = await fetch(`${base}/api/flows/flow-1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(FLOW_BODY)
  });
  if (response.status !== 200) {
    throw new Error(`Flow PUT failed: ${response.status} ${await response.text()}`);
  }
```
**Suggested test:** integration

**Example cases:**
- PUT /api/flows/invalid%2fid { flow: {...} }: returns 400 with INVALID_FLOW_ID
- PUT /api/flows/f-1 {} (empty body): returns 400 with VALIDATION_FAILED
- PUT /api/flows/f-1 { flow: { schedule: { enabled: true, intervalMs: 0 } } }: returns 400
- PUT /api/flows/f-1 { flow: { nodes: [{...}] } } (no edges, invalid graph): returns 400 with INVALID_FLOW_GRAPH
- PUT /api/flows/f-1 with valid flow: returns 200 with { flow: {...} }, createdAt unchanged if provided, updatedAt set to now

**Mocks/fixtures/setup:** HTTP server, createApp() with createStorage(), test both valid and invalid flow bodies, safe and unsafe flowIds

**Verification evidence:** grep -r 'PUT.*flows|INVALID_FLOW_GRAPH' /Users/ido/Documents/reddix/tests --include='*.test.ts' => no HTTP tests for PUT /flows endpoint; only utility function putFlow() in runNodeRoute.test.ts lines 85-94, which doesn't validate the response. The endpoint exists at /Users/ido/Documents/reddix/server/routes.ts lines 262-300. No HTTP tests verify (1) INVALID_FLOW_ID 400 for unsafe flowId, (2) VALIDATION_FAILED 400 for empty/malformed body, (3) schedule bounds checking, (4) INVALID_FLOW_GRAPH response structure, (5) response shape includes flow, or (6) createdAt/scheduleInterval fallbacks. api.test.ts lines 37-48 tests the client-side error handling but not the HTTP route itself.

---

### 9. buildBlockCommand - reddit.readPost case  
`src/shared/commandBuilders.ts` · **HIGH** · confidence high · command-builders-blockspecs

**Uncovered behavior:** The reddit.readPost block type (an enrichment block with required postId field and optional expandMore boolean) is never tested via buildBlockCommand, so argv construction for this block type is untested. This block is used in input-binding fanout scenarios where postId may be filled from upstream items.

**Why it matters:** Critical business logic: enrichment blocks execute once per upstream item. Untested argv construction means redaction boundaries, shell-injection protection, and argument ordering are unverified for this block type. The postId field is populated from input bindings in real execution.

**Production code:**
```
case 'reddit.readPost':
      return buildRedditReadPost(input.settings);
```
**Existing test** (`tests/commandBuilders.test.ts`):
```
(no excerpt)
```
**Suggested test:** unit

**Example cases:**
- builds reddit.readPost with default settings and expandMore=false
- builds reddit.readPost with expandMore=true produces correct --expand-more flag
- builds reddit.readPost with postId containing spaces or shell characters

**Mocks/fixtures/setup:** none - uses real blockSpecs

**Verification evidence:** grep -r 'buildBlockCommand' /Users/ido/Documents/reddix/tests --include='*.test.ts' returns 8 matches but all are in commandBuilders.test.ts. Grep for buildBlockCommand calls with blockType containing 'reddit.readPost': grep -r "blockType.*reddit.readPost" /Users/ido/Documents/reddix/tests/commandBuilders.test.ts returns ZERO matches. Only 4 buildBlockCommand test calls exist (lines 13, 60, 100, 110) testing reddit.searchPosts, twitter.searchTweets, twitter.timelineFeed, twitter.listTimeline. The reddit.readPost case at commandBuilders.ts line 37-38 calls buildRedditReadPost (line 157-165) but this builder function is never invoked via buildBlockCommand in tests.

---

### 10. buildBlockCommand - twitter.tweetDetail case  
`src/shared/commandBuilders.ts` · **HIGH** · confidence high · command-builders-blockspecs

**Uncovered behavior:** The twitter.tweetDetail block type (an enrichment block with required tweetIdOrUrl field that has custom 'twitter-id-or-url' format validation) is never tested via buildBlockCommand. The argv for --full-text conditional and tweet ID/URL handling is untested.

**Why it matters:** Critical security and correctness: this block uses isTwitterIdOrUrl() validation (line 314) which rejects non-HTTPS URLs and validates against x.com/twitter.com domains. The actual argv construction with tweetIdOrUrl values is never tested, leaving a gap in the no-shell-injection invariant for this block type.

**Production code:**
```
case 'twitter.tweetDetail':
      return buildTwitterTweetDetail(input.settings);
```
**Existing test** (`tests/commandBuilders.test.ts`):
```
(no excerpt)
```
**Suggested test:** unit

**Example cases:**
- builds twitter.tweetDetail with numeric tweet ID
- builds twitter.tweetDetail with https://x.com URL
- builds twitter.tweetDetail with fullText=true produces --full-text
- builds twitter.tweetDetail with fullText=false omits --full-text

**Mocks/fixtures/setup:** none - uses real blockSpecs

**Verification evidence:** grep -r 'twitter.tweetDetail' /Users/ido/Documents/reddix/tests --include='*.test.ts' returns matches in inputBindings.test.ts (testing inputBindingMeta only), runEngine.test.ts, runSingleNode.test.ts, and graph.test.ts (canConnect test). grep -r "buildBlockCommand.*twitter.tweetDetail" /Users/ido/Documents/reddix/tests --include='*.test.ts' returns ZERO matches. The buildTwitterTweetDetail function at line 237-245 is never tested via buildBlockCommand. The function has conditional logic for --full-text flag (line 241) and tweetIdOrUrl parameter handling that is untested in command building context.

---

### 11. validatePathField  
`src/shared/commandBuilders.ts` · **HIGH** · confidence high · command-builders-blockspecs

**Uncovered behavior:** The validatePathField function implements critical path security checks (null bytes, absolute paths, directory traversal) but is never directly tested. Path validation errors are never verified to be caught and reported correctly. The function is only called indirectly through validateBlockSettings when used via validateFlow, but no test exercises the specific error messages for path violations.

**Why it matters:** Critical security boundary: this function prevents directory traversal and null byte injection attacks on export paths. Although the downstream resolveContainedPath in artifactPath.test.ts tests null bytes, the validation layer (which should catch these BEFORE execution) is untested. A refactoring of this function could silently break path security.

**Production code:**
```
function validatePathField(field: FieldSpec, value: string): string | null {
  if (value.includes('\0')) {
    return `${field.label} is invalid`;
  }
  if (value.startsWith('/') || value.includes('\\')) {
    return `${field.label} must be a relative POSIX path`;
  }
  if (value.split('/').some((segment) => segment === '..')) {
    return `${field.label} cannot contain ".."`;
```
**Existing test** (`tests/commandBuilders.test.ts`):
```
(no excerpt)
```
**Suggested test:** unit

**Example cases:**
- rejects path with null byte: 'output\0.json'
- rejects absolute path: '/etc/passwd'
- rejects directory traversal: '../../etc/passwd'
- rejects backslash in path: 'output\\file.json'
- accepts valid relative POSIX path: 'outputs/report.json'

**Mocks/fixtures/setup:** none - pure function

**Verification evidence:** grep -r 'validatePathField\|cannot contain ".."\|must be a relative POSIX' /Users/ido/Documents/reddix/tests --include='*.test.ts' returns ZERO matches. grep -r 'validateBlockSettings\|validateFieldValue' /Users/ido/Documents/reddix/tests --include='*.test.ts' returns ZERO direct test matches. The validatePathField function at line 329-344 implements security checks (null bytes line 330, absolute paths line 333, directory traversal line 336, extension validation line 340-341) but these specific error messages are never tested. Path validation is tested indirectly only at artifactPath.test.ts for resolveContainedPath but not for validatePathField's format validation.

---

### 12. buildBlockCommand - reddit.browseSubreddit case  
`src/shared/commandBuilders.ts` · **HIGH** · confidence high · command-builders-blockspecs

**Uncovered behavior:** The reddit.browseSubreddit block type (a source block with required subreddit field and optional sort, timeRange, limit) is never tested via buildBlockCommand. The argv construction with multiple settings and fallback defaults is untested.

**Why it matters:** Correctness and security: this is a core source block used in most flows. The compact() function behavior, stringAndNumber coercion, and argv ordering are never verified. The required subreddit field must not be missing or malformed in argv.

**Production code:**
```
function buildRedditSubreddit(settings: Record<string, unknown>): BuiltCommand {
  const argv = compact([
    'sub',
    stringSetting(settings, 'subreddit', 'localdev'),
    '--sort',
    stringSetting(settings, 'sort', 'hot'),
    '--time',
    stringSetting(settings, 'timeRange', 'day'),
    '--limit',
    numberSetting(settings, 'limit', 50).toString(),
    '--compact',
    '--json'
  ]);
  return redditCommand(argv);
```
**Existing test** (`tests/commandBuilders.test.ts`):
```
(no excerpt)
```
**Suggested test:** unit

**Example cases:**
- builds reddit.browseSubreddit with required subreddit and defaults
- builds with custom sort value from allowed options
- builds with custom timeRange and limit
- builds reddit.browseSubreddit produces correct argv array order

**Mocks/fixtures/setup:** none - uses real blockSpecs

**Verification evidence:** grep -r 'reddit.browseSubreddit' /Users/ido/Documents/reddix/tests --include='*.test.ts' returns ZERO matches. grep -r 'buildBlockCommand' /Users/ido/Documents/reddix/tests/commandBuilders.test.ts shows only 4 test cases (lines 13, 60, 100, 110) testing reddit.searchPosts, twitter.searchTweets, twitter.timelineFeed, twitter.listTimeline. The buildRedditSubreddit function at commandBuilders.ts line 135-149 constructs argv with multiple settings (subreddit, sort, timeRange, limit) and fallback defaults (lines 138, 140, 142, 144) but this builder is never tested via buildBlockCommand.

---

### 13. buildRedditPopularAll  
`src/shared/commandBuilders.ts` · **HIGH** · confidence high · command-builders-blockspecs

**Uncovered behavior:** The reddit.popularAll builder has enum-like logic (line 152: ternary on listing value) that is never tested. The argv construction with the special 'all' vs 'popular' handling is untested. Both valid ('all', 'popular') and potentially invalid listing values are never verified to produce correct output.

**Why it matters:** Correctness: the ternary logic on line 152 is the only unique logic in this builder. If the condition is wrong or the fallback is changed, no test catches it. The block accepts a select field with options ['popular', 'all'] - the argv must use these values correctly.

**Production code:**
```
function buildRedditPopularAll(settings: Record<string, unknown>): BuiltCommand {
  const listing = stringSetting(settings, 'listing', 'popular') === 'all' ? 'all' : 'popular';
  const argv = [listing, '--limit', numberSetting(settings, 'limit', 50).toString(), '--compact', '--json'];
  return redditCommand(argv);
```
**Existing test** (`tests/commandBuilders.test.ts`):
```
(no excerpt)
```
**Suggested test:** unit

**Example cases:**
- builds reddit.popularAll with listing='popular' uses 'popular' as argv[0]
- builds reddit.popularAll with listing='all' uses 'all' as argv[0]
- builds with custom limit produces correct --limit value

**Mocks/fixtures/setup:** none - uses real blockSpecs

**Verification evidence:** grep -r 'reddit.popularAll\|buildRedditPopularAll' /Users/ido/Documents/reddix/tests --include='*.test.ts' returns ZERO matches. The buildRedditPopularAll function at line 151-155 implements enum-like logic at line 152: conditional ternary on listing value (stringSetting(settings, 'listing', 'popular') === 'all' ? 'all' : 'popular'). This conditional logic is never tested. The function is never invoked via buildBlockCommand in any test.

---

### 14. buildTwitterArticle  
`src/shared/commandBuilders.ts` · **HIGH** · confidence high · command-builders-blockspecs

**Uncovered behavior:** The twitter.article builder (line 252-256) has conditional format logic (line 253) and uses the 'twitter-id-or-url' validation format but is never tested via buildBlockCommand. The argv construction with articleIdOrUrl (required field) and format enum logic is untested.

**Why it matters:** Correctness: the format ternary logic must produce exactly '--markdown' or '--json'. The articleIdOrUrl field has custom validation (isTwitterIdOrUrl) which rejects invalid URLs. The complete argv for a valid twitter.article call is never verified to be correct.

**Production code:**
```
function buildTwitterArticle(settings: Record<string, unknown>): BuiltCommand {
  const format = stringSetting(settings, 'format', 'json') === 'markdown' ? '--markdown' : '--json';
  const argv = ['article', stringSetting(settings, 'articleIdOrUrl', ''), format];
  return twitterCommand(argv);
```
**Existing test** (`tests/commandBuilders.test.ts`):
```
(no excerpt)
```
**Suggested test:** unit

**Example cases:**
- builds twitter.article with format='json' uses --json
- builds twitter.article with format='markdown' uses --markdown
- builds twitter.article with numeric article ID
- builds twitter.article with https://x.com article URL

**Mocks/fixtures/setup:** none - uses real blockSpecs

**Verification evidence:** grep -r 'twitter.article' /Users/ido/Documents/reddix/tests/commandBuilders.test.ts returns ZERO matches. grep -r 'buildTwitterArticle' /Users/ido/Documents/reddix/tests --include='*.test.ts' returns ZERO matches. grep -r 'twitter.article' /Users/ido/Documents/reddix/tests --include='*.test.ts' returns 2 results both in graph.test.ts (line 137 for validation testing only, not buildBlockCommand). The buildTwitterArticle function at commandBuilders.ts line 252-256 has conditional format logic at line 253 (stringSetting(settings, 'format', 'json') === 'markdown' ? '--markdown' : '--json') and uses articleIdOrUrl required field. This builder is never tested via buildBlockCommand.

---

### 15. runFlow  
`server/runEngine.ts` · **HIGH** · confidence high · execution-engine

**Uncovered behavior:** failFast: true early termination when a CLI node fails. The code breaks out of the main flow loop at lines 148-150, but all runEngine tests use failFast: false. When failFast is true and any CLI node fails, subsequent unrelated nodes should not run; this control flow is untested.

**Why it matters:** failFast is a critical execution mode that users enable to stop a flow immediately on failure. If the break logic is broken, flows could continue running expensive operations despite failFast being set, wasting compute and potentially causing cascading failures.

**Production code:**
```
          if (options.flow.failFast) {
            break;
          }
```
**Existing test** (`tests/runEngine.test.ts`):
```
failFast: false,
```
**Suggested test:** unit

**Example cases:**
- failFast: true with two independent branches, first branch fails → second branch should not execute at all
- failFast: true with chain of 3 nodes, middle fails → nodes after it should be skipped (not just blocked)
- failFast: true with mixed CLI and transform nodes, transform fails → downstream should not execute
- failFast: false (control) with same setup → all 3 nodes should attempt to run

**Mocks/fixtures/setup:** Create two-branch flow (e.g., redditSearch+filter and twitterSearch+export, independent edges). Set first branch executor to fail, second to succeed. Assert steps array length stops early with failFast: true vs continues with failFast: false.

**Verification evidence:** grep -rn "failFast.*true" /Users/ido/Documents/reddix/tests/runEngine.test.ts /Users/ido/Documents/reddix/tests/runEngineLogging.test.ts /Users/ido/Documents/reddix/tests/runEngineRedaction.test.ts /Users/ido/Documents/reddix/tests/runSingleNode.test.ts returns no output. All runEngine execution tests use failFast: false (confirmed at lines 77, 117, 183, 234, 397, 430, 539, 580, 623 in runEngine.test.ts). Lines 148-150 in runEngine.ts contain the break statement for early termination when failFast is true, but this code path is never exercised by any test.

---

### 16. spawnCapped  
`server/executor.ts` · **HIGH** · confidence high · executor-process

**Uncovered behavior:** spawn() errors (ENOENT when executable doesn't exist, EACCES when not executable, etc.) that trigger the 'error' event handler are never tested. The handler captures error.message as stderr and returns exit code 127 (SPAWN_ERROR_EXIT_CODE), but no test spawns a nonexistent binary to verify this path.

**Why it matters:** CRITICAL: spawn errors are a real failure mode when a CLI binary is not found or not executable. The error handling path must be tested to ensure error.message is correctly propagated to stderr and the exit code is 127. This is part of the core executor security boundary.

**Production code:**
```
    child.on('error', (error) => {
      activeCliChildren.delete(child);
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      flushDecoders();
      resolve({ stdout: stdout.value, stderr: error.message, exitCode: SPAWN_ERROR_EXIT_CODE });
    });
```
**Existing test** (`tests/executor.test.ts`):
```
(no excerpt)
```
**Suggested test:** unit

**Example cases:**
- spawnCapped with nonexistent executable (e.g., '/nonexistent/binary') should return exitCode 127 and error message in stderr
- spawnCapped when binary exists but is not executable should return exitCode 127 and EACCES error in stderr
- spawnCapped with spawn error should clean up activeCliChildren

**Mocks/fixtures/setup:** No mocks needed; use a truly nonexistent path like '/no/such/executable/exists' that spawn will fail to find, or use a directory path instead of a binary.

**Verification evidence:** grep -rn 'SPAWN_ERROR_EXIT_CODE\|spawn.*error\|127\|ENOENT\|EACCES' /Users/ido/Documents/reddix/tests returned no matches for executor error handling tests. The error event handler (lines 126-135 of executor.ts) that captures error.message and returns SPAWN_ERROR_EXIT_CODE (127) is never tested. No test spawns a nonexistent executable (e.g., '/not/a/real/binary') to verify this path executes.

---

### 17. resolveCliTimeoutMs  
`server/executor.ts` · **HIGH** · confidence high · executor-process

**Uncovered behavior:** resolveCliTimeoutMs() is exported but never unit-tested directly. It is used via spawnCapped in integration tests, but there is no dedicated test verifying: (1) valid timeout values are parsed correctly, (2) invalid/negative values fall back to DEFAULT_TIMEOUT_MS, (3) 0 and Infinity are rejected.

**Why it matters:** HIGH: The timeout is a critical security control that prevents malicious/infinite processes from hanging the system. The resolution logic must be tested in isolation to ensure all edge cases (NaN, negative, zero, invalid string) are handled correctly. A bug here could allow a timeout override to be ignored.

**Production code:**
```
export function resolveCliTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = Number(env.REDDIX_CLI_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}
```
**Existing test** (`tests/executor.test.ts`):
```
(no excerpt)
```
**Suggested test:** unit

**Example cases:**
- resolveCliTimeoutMs({ REDDIX_CLI_TIMEOUT_MS: '5000' }) should return 5000
- resolveCliTimeoutMs({ REDDIX_CLI_TIMEOUT_MS: '-1' }) should return DEFAULT_TIMEOUT_MS
- resolveCliTimeoutMs({ REDDIX_CLI_TIMEOUT_MS: '0' }) should return DEFAULT_TIMEOUT_MS
- resolveCliTimeoutMs({}) should return DEFAULT_TIMEOUT_MS

**Mocks/fixtures/setup:** None; pure function tests.

**Verification evidence:** grep -rn 'resolveCliTimeoutMs' /Users/ido/Documents/reddix/tests returned zero direct unit test matches. The function (lines 39-42) is exported and used in createCliExecutor, but no dedicated test exists. executorLogging.test.ts uses REDDIX_CLI_TIMEOUT_MS env var indirectly (line 47) but never tests resolveCliTimeoutMs() itself. No tests verify: (1) valid timeout parsed correctly, (2) invalid/negative values fall back to DEFAULT_TIMEOUT_MS, (3) 0 and Infinity are rejected.

---

### 18. buildCliEnv  
`server/executor.ts` · **HIGH** · confidence high · executor-process

**Uncovered behavior:** buildCliEnv() is a private function never tested. It must verify: (1) only PATH, HOME, TMPDIR, and AUTH_ENV_KEYS (TWITTER_AUTH_TOKEN, TWITTER_CT0) are passed through, (2) all other env vars are dropped, (3) empty/undefined values are filtered out, (4) auth tokens ARE included when present.

**Why it matters:** CRITICAL SECURITY: This function enforces the least-privilege env contract — it should prevent secret leakage by only allowing safe env vars. If a test doesn't verify that other env vars are EXCLUDED, a developer could accidentally modify this and leak secrets (e.g., AWS_ACCESS_KEY, DATABASE_URL). Also verifies auth tokens are correctly passed.

**Production code:**
```
function buildCliEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const passthroughKeys = ['PATH', 'HOME', 'TMPDIR', ...AUTH_ENV_KEYS];
  return passthroughKeys.reduce<NodeJS.ProcessEnv>((next, key) => {
    const value = env[key];
    return value ? { ...next, [key]: value } : next;
  }, {});
}
```
**Existing test** (`tests/executor.test.ts`):
```
(no excerpt)
```
**Suggested test:** unit

**Example cases:**
- buildCliEnv includes PATH, HOME, TMPDIR when present
- buildCliEnv includes TWITTER_AUTH_TOKEN and TWITTER_CT0 from AUTH_ENV_KEYS when present
- buildCliEnv drops all other env vars (e.g., AWS_ACCESS_KEY, DATABASE_URL, USER)
- buildCliEnv filters out empty/undefined values and does not set them as ''
- buildCliEnv result contains exactly the expected keys, no extras

**Mocks/fixtures/setup:** None; pure function test with a test env object.

**Verification evidence:** grep -rn 'buildCliEnv' /Users/ido/Documents/reddix/tests returned zero matches. grep -rn 'PATH.*HOME.*TMPDIR' /Users/ido/Documents/reddix/tests returned zero matches. The private function (lines 26-32 in executor.ts) is never tested. No test verifies: (1) only PATH, HOME, TMPDIR, AUTH_ENV_KEYS are passed through, (2) all other env vars dropped, (3) empty/undefined values filtered, (4) auth tokens included when present.

---

### 19. checkExecutable  
`server/executor.ts` · **HIGH** · confidence high · executor-process

**Uncovered behavior:** checkExecutable() is exported and used by the health check route, but never tested. The function should verify: (1) returns true only when exit code is 0, (2) returns false for spawn errors (ENOENT), (3) returns false for nonzero exits, (4) respects HEALTH_CHECK_TIMEOUT_MS cap, (5) respects HEALTH_CHECK_MAX_OUTPUT_BYTES cap.

**Why it matters:** HIGH: checkExecutable is the public health check API for verifying CLI binaries are available. If not tested, a provider could be marked healthy when its binary is missing, causing the flow to fail at runtime instead of being caught during health check.

**Production code:**
```
export async function checkExecutable(executable: string): Promise<boolean> {
  const result = await spawnCapped(executable, ['--help'], {
    env: buildCliEnv(process.env),
    maxOutputBytes: HEALTH_CHECK_MAX_OUTPUT_BYTES,
    timeoutMs: Math.min(resolveCliTimeoutMs(process.env), HEALTH_CHECK_TIMEOUT_MS)
  });
  return result.exitCode === 0;
}
```
**Existing test** (`tests/executor.test.ts`):
```
(no excerpt)
```
**Suggested test:** unit

**Example cases:**
- checkExecutable(process.execPath) should return true
- checkExecutable('/nonexistent/binary') should return false (spawn error)
- checkExecutable with a command that exits 1 should return false
- checkExecutable should timeout quickly (< HEALTH_CHECK_TIMEOUT_MS)

**Mocks/fixtures/setup:** Use process.execPath for true path, /nonexistent/binary for false path, or a Node script that exits 1.

**Verification evidence:** grep -rn 'checkExecutable' /Users/ido/Documents/reddix/tests returned zero direct unit test matches. The function (lines 212-219) is exported and used in routes.ts:86 as the default providerHealthChecker. healthRoute.test.ts (line 28) mocks providerHealthChecker, preventing direct testing. No test verifies: (1) returns true only for exit code 0, (2) returns false for spawn errors, (3) returns false for nonzero exits, (4) respects HEALTH_CHECK_TIMEOUT_MS, (5) respects HEALTH_CHECK_MAX_OUTPUT_BYTES.

---

### 20. spawnCapped  
`server/executor.ts` · **HIGH** · confidence high · executor-process

**Uncovered behavior:** Test only verifies that reason is in stderr, but does NOT verify the specific case when stderr is NOT empty before truncation: the test must verify that existing stderr content is preserved and the reason is APPENDED with a newline (not replaced). Also no test for stderr-only truncation (when only stderr exceeds cap, stdout is fine).

**Why it matters:** HIGH: The combinedStderr logic ensures error context is not lost when the process writes error diagnostics to stderr BEFORE hitting the cap. A test must verify stderr = 'existing error content\n[reddix] output exceeded...' format is correct. Missing this could hide bugs where the reason overwrites important diagnostics.

**Production code:**
```
      if (stdout.truncated || stderr.truncated) {
        const reason = `[reddix] output exceeded ${options.maxOutputBytes} bytes; process terminated`;
        const combinedStderr = stderr.value ? `${stderr.value}\n${reason}` : reason;
        resolve({ stdout: stdout.value, stderr: combinedStderr, exitCode: OUTPUT_LIMIT_EXIT_CODE });
        return;
      }
```
**Existing test** (`tests/executor.test.ts`):
```
    expect(result.stderr).toContain('output exceeded');
```
**Suggested test:** unit

**Example cases:**
- spawnCapped when stderr has content and is then truncated, final stderr is original + newline + reason
- spawnCapped when only stderr exceeds cap (stdout is fine), still returns OUTPUT_LIMIT_EXIT_CODE
- spawnCapped when only stdout exceeds cap (stderr is fine), stderr still contains the truncation reason
- spawnCapped with empty initial stderr on truncation, reason is NOT prefixed with newline

**Mocks/fixtures/setup:** Process that writes to stderr, then writes large stdout to trigger truncation. E.g., `process.stderr.write('error msg'); process.stdout.write('x'.repeat(500000))`

**Verification evidence:** grep -rn 'SPAWN_ERROR_EXIT_CODE\|spawn.*error\|127\|ENOENT\|EACCES' /Users/ido/Documents/reddix/tests returned no matches for executor error handling tests. The error event handler (lines 126-135 of executor.ts) that captures error.message and returns SPAWN_ERROR_EXIT_CODE (127) is never tested. No test spawns a nonexistent executable (e.g., '/not/a/real/binary') to verify this path executes.

---

### 21. spawnCapped  
`server/executor.ts` · **HIGH** · confidence high · executor-process

**Uncovered behavior:** Timeout test (executorLogging.test.ts:40-57) verifies the timeout is detected but does NOT verify: (1) the reason is appended to stderr correctly when stderr has prior content, (2) exit code is TIMEOUT_EXIT_CODE (124), (3) timeout fires exactly once and doesn't double-settle.

**Why it matters:** HIGH: Timeout handling is security-critical (prevents DoS/infinite loops). The test must verify exit code 124 is returned (not 0 or 1) so callers can distinguish timeout from normal failure. Also must verify stderr is appended correctly (as with truncation).

**Production code:**
```
      if (timedOut) {
        const reason = `[reddix] process timed out after ${timeoutMs} ms; process terminated`;
        const combinedStderr = stderr.value ? `${stderr.value}\n${reason}` : reason;
        resolve({ stdout: stdout.value, stderr: combinedStderr, exitCode: TIMEOUT_EXIT_CODE });
        return;
      }
```
**Existing test** (`tests/executorLogging.test.ts`):
```
      expect(result.stderr).toContain('timed out');
```
**Suggested test:** unit

**Example cases:**
- spawnCapped with timeout should return exitCode === TIMEOUT_EXIT_CODE (124)
- spawnCapped with timeout and stderr content should append reason to stderr with newline
- spawnCapped timeout should kill the child process tree
- spawnCapped with timeout and empty stderr should return just the reason message

**Mocks/fixtures/setup:** Process that hangs indefinitely (setInterval(() => {}, 1000)) with a short timeout; optionally add stderr output.

**Verification evidence:** grep -rn 'SPAWN_ERROR_EXIT_CODE\|spawn.*error\|127\|ENOENT\|EACCES' /Users/ido/Documents/reddix/tests returned no matches for executor error handling tests. The error event handler (lines 126-135 of executor.ts) that captures error.message and returns SPAWN_ERROR_EXIT_CODE (127) is never tested. No test spawns a nonexistent executable (e.g., '/not/a/real/binary') to verify this path executes.

---

### 22. spawnCapped  
`server/executor.ts` · **HIGH** · confidence high · executor-process

**Uncovered behavior:** Tests verify exitCode 0 and 'not 0', but never verify a specific nonzero exit code (e.g., 1, 42, 255) is passed through unchanged. The finalize() function line 100 resolves with the actual exit code, but no test confirms this behavior for non-special cases.

**Why it matters:** MEDIUM: The executor must preserve the actual exit code from the child process so callers can distinguish different failure modes (exit 1 vs exit 2, etc.). Without this test, a bug could be introduced that masks or alters exit codes, breaking step failure detection.

**Production code:**
```
      resolve({ stdout: stdout.value, stderr: stderr.value, exitCode });
```
**Existing test** (`tests/executor.test.ts`):
```
    expect(result.exitCode).toBe(0);
```
**Suggested test:** unit

**Example cases:**
- spawnCapped with process.exit(1) should return exitCode === 1
- spawnCapped with process.exit(42) should return exitCode === 42
- spawnCapped with process.exit(255) should return exitCode === 255

**Mocks/fixtures/setup:** Node script that calls process.exit() with a specific code: ['-e', 'process.exit(42)']

**Verification evidence:** grep -rn 'SPAWN_ERROR_EXIT_CODE\|spawn.*error\|127\|ENOENT\|EACCES' /Users/ido/Documents/reddix/tests returned no matches for executor error handling tests. The error event handler (lines 126-135 of executor.ts) that captures error.message and returns SPAWN_ERROR_EXIT_CODE (127) is never tested. No test spawns a nonexistent executable (e.g., '/not/a/real/binary') to verify this path executes.

---

### 23. Dashboard  
`src/components/Dashboard.tsx` · **HIGH** · confidence high · frontend-components

**Uncovered behavior:** Dashboard component has no test coverage. No tests verify: (1) that onOpen is invoked with the correct flow ID when a flow card is clicked; (2) that onClose is called when Back button is clicked; (3) that the activeFlowId indicator correctly marks the currently-open flow with ' · open'; (4) that flow cards render correct status color via DOT_COLOR mapping; (5) that onNew callback fires when New flow card is clicked; (6) that modal a11y wiring via useModalA11y is active (focus trap, escape handling).

**Why it matters:** Dashboard is the main entry point for flow navigation and selection. Bugs in flow card click handling, status indicator logic, or onNew callback invocation directly affect user ability to open flows and create new ones. The modal's accessibility (focus management, escape key) is essential for keyboard and assistive-technology users.

**Production code:**
```
export function Dashboard({ flows, activeFlowId, onOpen, onClose, onNew }: DashboardProps) {
  const dialogRef = useModalA11y<HTMLDivElement>(onClose);
  return (
    <div ref={dialogRef} className="dash-scrim" role="dialog" aria-modal="true" aria-label="Flows" tabIndex={-1}>
      <div className="dash-top">
        ...
        <button className="btn btn-sm" type="button" onClick={onClose}>
          Back to editor
        </button>
      </div>
      <div className="dash-body">
        ...
        <div className="flow-grid">
          {flows.map((flow) => (
            <button className="flow-card" key={flow.id} type="button" onClick={() => onOpen(flow.id)}>
              ...
              <div className="fc-top">
                <span className="fc-dot" style={{ background: DOT_COLOR[flow.status] }} />
                <span className="fc-status">
                  {flow.statusLabel}
                  {flow.id === activeFlowId ? ' · open' : ''}
                </span>
              </div>
              ...
            </button>
          ))}
            <button className="flow-card new-card" type="button" onClick={onNew}>
              ...
              <div style={{ marginTop: 8, fontWeight: 600, fontSize: 13 }}>New flow</div>
            </button>
        </div>
```
**Existing test:** none.
**Suggested test:** unit

**Example cases:**
- Clicking a flow card invokes onOpen with the correct flow ID
- Back button click invokes onClose callback
- Active flow indicator displays ' · open' suffix only for activeFlowId
- Flow status dot colors match DOT_COLOR mapping (scheduled→output, idle→ink-300, error→brand-600)
- New flow button invokes onNew callback when clicked

**Mocks/fixtures/setup:** Mock onOpen, onClose, onNew callbacks. Create fixture flows with different statuses (scheduled, idle, error) and verify status labels render. Mock useModalA11y hook.

**Verification evidence:** grep -r 'Dashboard' /Users/ido/Documents/reddix/tests --include='*.test.tsx' --include='*.test.ts' returned (no output). grep -r 'flow-card\|flow-grid\|activeFlowId\|onOpen.*flow' /Users/ido/Documents/reddix/tests --include='*.test.tsx' --include='*.test.ts' returned (no output). Dashboard component exists at src/components/Dashboard.tsx with props onOpen, onClose, onNew, activeFlowId, and DOT_COLOR mapping, but no test file exists that exercises any of these behaviors.

---

### 24. ScheduleModal  
`src/components/ScheduleModal.tsx` · **HIGH** · confidence high · frontend-components

**Uncovered behavior:** ScheduleModal component has no test. No tests verify: (1) clicking a preset button updates cron state and the preset becomes visually selected; (2) manual cron input is validated and updates cadence hint; (3) invalid cron expressions degrade gracefully (default to 24h); (4) enabled toggle updates state and label text; (5) Save button invokes onSave with correct payload (enabled, cron, intervalMs); (6) onClose is invoked when scrim is clicked (but NOT when modal interior is clicked); (7) cronExplain and describeInterval utilities are correctly called and displayed in hint; (8) paused state label appears/disappears correctly.

**Why it matters:** ScheduleModal controls flow scheduling—a core feature. Bugs in preset selection, cron validation, or state persistence directly impact whether schedules are saved correctly. The scrim-click-to-close pattern is a UX edge case; modal interior click-through would break keyboard usage.

**Production code:**
```
export function ScheduleModal({ schedule, onClose, onSave }: ScheduleModalProps) {
  const [cron, setCron] = useState(schedule.cron || '0 9 * * 1');
  const [enabled, setEnabled] = useState(schedule.enabled);
  const matched = presetForCron(cron);
  const dialogRef = useModalA11y<HTMLDivElement>(onClose);

  return (
    <div className="scrim" onPointerDown={onClose}>
      <div
        ref={dialogRef}
        ...
        onPointerDown={(event) => event.stopPropagation()}
      >
        ...
        <div className="cron-presets">
          {SCHEDULE_PRESETS.map((preset) => {
            const isOn = matched ? matched.id === preset.id : preset.id === 'custom';
            return (
              <button
                ...
                onClick={() => preset.cron && setCron(preset.cron)}
              >
              </button>
            );
          })}
        </div>
        <input
          ...
          value={cron}
          onChange={(event) => setCron(event.target.value)}
        />
        <div className="field-hint">
          {cronExplain(cron)} Effective cadence: <strong>{describeInterval(cronToIntervalMs(cron))}</strong>
          {enabled ? '' : ' (paused)'}.  
        </div>
        <button
          ...
          aria-label="Schedule enabled"
          onClick={() => setEnabled((current) => !current)}
        >
        </button>
        <button
          ...
          onClick={() => onSave({ enabled, cron, intervalMs: cronToIntervalMs(cron) })}
        >
```
**Existing test:** none.
**Suggested test:** unit

**Example cases:**
- Clicking a preset button sets cron to that preset's expression and highlights it as selected
- Manual cron input updates state and refreshes cadence hint display
- Save button calls onSave with { enabled, cron, intervalMs } payload
- Enabled toggle switches state and updates label between 'Schedule enabled'/'Schedule paused'
- Scrim click invokes onClose; modal interior click does not

**Mocks/fixtures/setup:** Mock onClose, onSave. Create schedule fixtures with different cron values. Mock cronExplain and describeInterval if not directly testing scheduleCadence. Test with standard presets (daily, weekly) and custom cron.

**Verification evidence:** grep -r 'ScheduleModal' /Users/ido/Documents/reddix/tests --include='*.test.tsx' --include='*.test.ts' returned (no output). grep -r 'cron-preset\|schedule-toggle\|cron.*input' /Users/ido/Documents/reddix/tests returned only hits in scheduleCadence.test.ts for utility functions (cronToIntervalMs, cronExplain, presetForCron) but NOT the component that uses them. ScheduleModal.tsx file exists with preset buttons, cron input, enabled toggle, and onSave callback, but no component test covers this UI behavior.

---

### 25. useModalA11y  
`src/hooks/useModalA11y.ts` · **HIGH** · confidence high · frontend-components

**Uncovered behavior:** useModalA11y has no direct test coverage. No tests verify: (1) focus moves into the modal on mount to the first focusable element (or container if no focusables); (2) Escape key triggers onClose and preventDefault; (3) Tab from last focusable cycles to first; (4) Shift+Tab from first focusable cycles to last; (5) Shift+Tab from the container cycles to last; (6) focus is restored to the previously-focused element on unmount/cleanup; (7) Tab/Shift+Tab are trapped within the modal and don't leak to document.

**Why it matters:** Focus trap and escape handling are critical for modal accessibility (WCAG 2.1 Level AA). A broken focus trap breaks keyboard navigation for all users and assistive-tech users cannot escape modals. A missing escape handler prevents keyboard-only users from closing the modal.

**Production code:**
```
export function useModalA11y<T extends HTMLElement>(onClose: () => void): React.RefObject<T> {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const container = ref.current;
    if (!container) {
      return;
    }
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = focusables()[0];
    (first ?? container).focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === firstItem || active === container)) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);
```
**Existing test:** none.
**Suggested test:** unit

**Example cases:**
- Focus moves to first focusable child on mount; if none, focus moves to container
- Pressing Escape calls onClose and prevents default
- Tab from last focusable element cycles focus to first
- Shift+Tab from first focusable element cycles focus to last
- Shift+Tab while container is focused cycles to last focusable
- On cleanup, focus is restored to the previously-focused element
- Tab/Shift+Tab do not move focus outside the modal

**Mocks/fixtures/setup:** Create a test component that uses useModalA11y and renders a modal with focusable children (button, input). Mock document.activeElement. Spy on focus() and onClose. Use renderHook or render in a test container. Simulate keydown events via fireEvent.

**Verification evidence:** grep -r 'useModalA11y' /Users/ido/Documents/reddix/tests --include='*.test.tsx' --include='*.test.ts' returned (no output). grep -r 'focus.*trap\|Escape.*close\|Tab.*cycle' /Users/ido/Documents/reddix/tests returned only BlockPalette.test.tsx which tests palette tab navigation, not the modal a11y hook. Hook is used by Dashboard and ScheduleModal but never directly tested or indirectly verified through component tests.

---

### 26. useProviderHealth  
`src/hooks/useProviderHealth.ts` · **HIGH** · confidence high · frontend-components

**Uncovered behavior:** useProviderHealth has no test coverage. No tests verify: (1) isLoading is true initially; (2) fetchHealth is called once on mount; (3) on success, state updates to { providers: [...], isLoading: false, hasError: false }; (4) on error (network or API), state updates to { providers: [], isLoading: false, hasError: true }; (5) error reason is extracted and logged via console.warn; (6) cancellation flag prevents state updates if hook unmounts during fetch; (7) missing fetch global (SSR case) sets error state immediately.

**Why it matters:** Provider health is a core spec requirement (blockVisuals comment: 'missing or unhealthy binary is a core spec requirement to surface'). A broken health check hides CLI failures from the UI, preventing users from discovering that a provider is misconfigured. Cancellation bug can cause setState-on-unmounted-component warnings or stale state updates.

**Production code:**
```
export function useProviderHealth(): ProviderHealthState {
  const [state, setState] = useState<ProviderHealthState>({
    providers: [],
    isLoading: true,
    hasError: false
  });

  useEffect(() => {
    if (typeof fetch === 'undefined') {
      setState({ providers: [], isLoading: false, hasError: true });
      return;
    }
    let cancelled = false;
    fetchHealth()
      .then((health) => {
        if (!cancelled) {
          setState({ providers: health.providers ?? [], isLoading: false, hasError: false });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const reason = error instanceof Error ? error.message : 'Unknown error';
          console.warn('Provider health check failed:', reason);
          setState({ providers: [], isLoading: false, hasError: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
```
**Existing test:** none.
**Suggested test:** unit

**Example cases:**
- Initial state is { providers: [], isLoading: true, hasError: false }
- On successful fetch, state updates to { providers: [...], isLoading: false, hasError: false }
- On fetch error, state updates to { providers: [], isLoading: false, hasError: true } and error is logged
- When fetch is undefined (SSR), state is immediately { providers: [], isLoading: false, hasError: true }
- Unmounting during fetch (cancelled=true) prevents state update on promise resolution

**Mocks/fixtures/setup:** Mock fetchHealth to return success or reject with error. Use renderHook from @testing-library/react. Spy on console.warn. Test both SSR (typeof fetch === 'undefined') and browser environments. Simulate unmount during fetch using waitFor + useEffect cleanup.

**Verification evidence:** grep -r 'useProviderHealth' /Users/ido/Documents/reddix/tests --include='*.test.tsx' --include='*.test.ts' returned (no output). grep -r 'fetchHealth\|ProviderHealthState' /Users/ido/Documents/reddix/tests returned (no output). TopBar.test.tsx and healthRoute.test.ts test provider health UI rendering and API endpoints, but not the useProviderHealth hook itself (isLoading state, fetchHealth call, error handling, cancellation flag).

---

### 27. useIsMobile  
`src/hooks/useIsMobile.ts` · **HIGH** · confidence high · frontend-components

**Uncovered behavior:** useIsMobile has no test coverage. No tests verify: (1) on SSR (window undefined), hook returns false; (2) on browser, initial state matches window.matchMedia(query).matches at mount time; (3) matchMedia change event listener is added on mount; (4) state updates when viewport resizes and crosses MOBILE_BREAKPOINT_PX; (5) listener is cleaned up on unmount; (6) the query string is correctly formatted with MOBILE_BREAKPOINT_PX (900px).

**Why it matters:** useIsMobile determines whether the workbench is read-only. If the hook fails to detect mobile breakpoint correctly, authoring actions (node drag, wiring, block add) will be enabled on mobile, breaking the design contract that 'mobile is a monitor-only surface.'

**Production code:**
```
const query = `(max-width: ${MOBILE_BREAKPOINT_PX}px)`;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia(query);
    const onChange = (): void => setIsMobile(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
```
**Existing test:** none.
**Suggested test:** unit

**Example cases:**
- Returns false on SSR (window undefined)
- Initial state matches window.matchMedia('(max-width: 900px)').matches
- Listener fires on matchMedia change event; state updates to new matches value
- Listener is removed on cleanup/unmount
- Query string includes correct MOBILE_BREAKPOINT_PX value (900px)

**Mocks/fixtures/setup:** Mock window.matchMedia and its change event. Use renderHook. Test both SSR (window undefined) and browser cases. Simulate viewport resize by triggering matchMedia change event and checking state update.

**Verification evidence:** grep -r 'useIsMobile' /Users/ido/Documents/reddix/tests --include='*.test.tsx' --include='*.test.ts' returned (no output). grep -r 'MOBILE_BREAKPOINT\|900px\|matchMedia' /Users/ido/Documents/reddix/tests returned (no output). Hook defined in useIsMobile.ts implements SSR safety, window.matchMedia listener, and viewport resize handling, but no test covers any of these behaviors.

---

### 28. useTheme  
`src/hooks/useTheme.ts` · **HIGH** · confidence high · frontend-components

**Uncovered behavior:** useTheme has no test coverage. No tests verify: (1) readStoredTheme returns localStorage value if valid ('light' or 'dark'); (2) readStoredTheme falls back to prefers-color-scheme if localStorage is empty; (3) readStoredTheme defaults to 'light' if both are unavailable; (4) SSR case (window undefined) defaults to 'light'; (5) on mount, theme state is set to stored/OS preference; (6) changing theme updates document.documentElement.data-theme attribute; (7) changing theme persists to localStorage; (8) toggleTheme flips between 'light' and 'dark'.

**Why it matters:** Theme is user-facing state that persists across sessions. Bugs in storage or attribute sync break theme persistence (user sets dark mode, page reloads → resets to light). Missing data-theme update breaks CSS color scheme. SSR hydration mismatch (server renders light, client reads dark) causes visual flicker.

**Production code:**
```
function readStoredTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'light';
  }
  const stored = window.localStorage?.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
    window.localStorage?.setItem(STORAGE_KEY, theme);
  }, [theme]);
```
**Existing test:** none.
**Suggested test:** unit

**Example cases:**
- readStoredTheme returns localStorage value if set to 'light' or 'dark'
- readStoredTheme falls back to prefers-color-scheme: dark if localStorage empty
- readStoredTheme defaults to 'light' if no stored value and no OS preference
- Initial theme state matches readStoredTheme result
- Changing theme updates document.documentElement.data-theme
- Changing theme persists to localStorage
- toggleTheme switches between 'light' and 'dark'

**Mocks/fixtures/setup:** Mock window.localStorage.getItem/setItem. Mock document.documentElement.setAttribute. Mock window.matchMedia. Use renderHook. Test SSR case (window undefined). Test localStorage retrieval and persistence.

**Verification evidence:** grep -r 'useTheme' /Users/ido/Documents/reddix/tests --include='*.test.tsx' --include='*.test.ts' returned (no output). grep -r 'reddix-theme\|data-theme\|readStoredTheme\|toggleTheme' /Users/ido/Documents/reddix/tests returned (no output). useTheme.ts implements theme initialization from localStorage/OS preference, DOM synchronization via data-theme attribute, and toggleTheme callback, but no test covers these behaviors. useOnboarding.test.ts uses localStorage mocking but does not test useTheme.

---

### 29. Canvas wire-drag commitWire  
`src/components/Canvas.tsx` · **HIGH** · confidence high · frontend-components

**Uncovered behavior:** Canvas wiring commit behavior is not tested. Canvas.test.tsx covers node-splice and edge-delete but NOT: (1) starting a wire drag from an output port; (2) moving the temporary wire while dragging; (3) releasing the wire over an input port on a *different* node (valid connection); (4) releasing the wire over the *same* node's input (should NOT connect); (5) releasing over a non-port element (wire is cleared, no connection); (6) port hover highlight during wire drag; (7) connection validity check via canConnect (hoisted from Canvas.tsx line 515-522); (8) clearing temp wire state on invalid release.

**Why it matters:** Wiring is the core abstraction for flow composition. If a user can wire a node to itself, or if releasing on the wrong port creates an invalid connection, data flow breaks silently. A missing connection-validity check (canConnect) lets users create impossible connections.

**Production code:**
```
const commitWire = (from: string, fromPort: string, event: PointerEvent): void => {
  const element = document.elementFromPoint(event.clientX, event.clientY);
  const portEl = element?.closest('[data-role="port-in"]');
  if (portEl) {
    const toNode = portEl.getAttribute('data-node')!;
    const toPort = portEl.getAttribute('data-port')!;
    if (toNode !== from) {
      onConnect(from, fromPort, toNode, toPort);
    }
  }
  setTemp(null);
  setHoverPort(null);
  setConnecting(false);
};
```
**Existing test** (`tests/Canvas.test.tsx`):
```
describe('Canvas edge delete glyph', () => {
  it('invokes onDeleteEdge when the midpoint delete glyph is pressed', () => {
    const onDeleteEdge = vi.fn();
    const { container } = renderCanvas({ selectedEdgeId: 'edge-1', onDeleteEdge });

    const glyph = container.querySelector('.edge-del');
    expect(glyph).not.toBeNull();
    fireEvent.pointerDown(glyph!);

    expect(onDeleteEdge).toHaveBeenCalledWith('edge-1');
  });
});
```
**Suggested test:** unit

**Example cases:**
- Dragging from output port starts wire drag and sets temp state with port coordinates
- Releasing wire over input port on different node invokes onConnect with source, sourcePort, target, targetPort
- Releasing wire over same node's input does NOT invoke onConnect
- Releasing wire over non-port element clears temp state and does not call onConnect
- Port hover highlight shows during wire drag over valid input port

**Mocks/fixtures/setup:** Create mock nodes with input/output ports. Mock onConnect, onSelectEdge. Use renderCanvas with multiple nodes. Simulate pointer down on output port, move, release on input port. Mock document.elementFromPoint to return port elements.

**Verification evidence:** Canvas.test.tsx tests edge-delete glyph and node-into-edge splice behavior but grep -n 'commitWire\|wire.*drag\|port-out\|port-in' /Users/ido/Documents/reddix/tests/Canvas.test.tsx returns only the onConnect callback stub and fixture setup. No test exercises the wire drag flow: starting drag from output port, moving temp wire, releasing over input port on different node, or validity check via canConnect. commitWire function (lines 241-254 in Canvas.tsx) and port-out role handlers (lines 162-173) are never tested.

---

### 30. postRunNode  
`src/api.ts` · **HIGH** · confidence high · frontend-state-api

**Uncovered behavior:** postRunNode has zero test coverage. The function handles: (1) network failure and non-JSON responses (throw status error), (2) 422 with failed RunRecord body (return the failed run), (3) 422 without run body (throw error message or status fallback), (4) successful 2xx with run record (return it). All code paths in postRunNode are untested.

**Why it matters:** postRunNode is the API contract for single-node runs (cached-upstream mode + static mode), which is a critical user feature in useWorkbenchState.runNode. Network failures, malformed responses, and error message handling directly impact end user experience when running individual nodes. An uncaught exception or wrong status code thrown would break the runNode flow.

**Production code:**
```
export async function postRunNode(flowId: string, nodeId: string, mode: RunNodeMode): Promise<RunRecord> {
  const response = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flowId, nodeId, mode })
  });
  let payload: { run?: RunRecord; error?: string };
  try {
    payload = (await response.json()) as { run?: RunRecord; error?: string };
  } catch {
    throw new Error(`Run node request failed (status ${response.status})`);
  }
  if (!payload.run) {
    throw new Error(payload.error ?? `Run node failed (status ${response.status})`);
  }
  return payload.run;
}
```
**Existing test** (`tests/api.test.ts`):
```
(no excerpt)
```
**Suggested test:** unit

**Example cases:**
- POSTs the flowId, nodeId, and mode to /api/runs with correct headers
- Returns a successful RunRecord on 200 response with run body
- Returns a failed RunRecord on 422 with run body (not throwing)
- Throws with error message when 422 has no run but has error field
- Throws status error when response JSON parse fails (network/5xx with empty body)

**Mocks/fixtures/setup:** Mock fetch with jsonResponse() and nonJsonResponse() helpers from api.test.ts. Test with responses: {ok: true, status: 200, body: {run: {...}}}, {ok: false, status: 422, body: {run: {...}}}, {ok: false, status: 422, body: {error: 'message'}}, {ok: false, status: 503, unparseable body}

**Verification evidence:** grep -rn 'postRunNode' /Users/ido/Documents/reddix/tests/ returned no matches. api.test.ts lines 1-114 imports postRun (line 2) and subscribeRunEvents but NOT postRunNode. No tests exist for postRunNode. The function at api.ts lines 151-168 handles: (1) network failure with non-JSON body (line 160-161: throws 'Run node request failed'), (2) 422 with failed run body (line 164: returns it), (3) 422 without run body (line 165: throws fallback), (4) successful 2xx (line 167: returns run). All paths untested.

---

### 31. saveSchedule  
`src/hooks/useWorkbenchState.ts` · **HIGH** · confidence high · frontend-state-api

**Uncovered behavior:** saveSchedule has zero test coverage. The function: (1) updates local schedule state immediately, (2) calls saveFlow with schedule interval transformed from cron, (3) shows different toast/status based on enabled flag, (4) catches and surfaces saveFlow errors. Neither the happy path (save success with enabled/disabled schedules) nor the error path (saveFlow failure with error message) are tested.

**Why it matters:** saveSchedule is the only way users persist flow automation. If saveFlow fails silently or throws without proper error handling, the UI state (schedule enabled/disabled) becomes inconsistent with the backend. Users could think a schedule was saved when it failed, or fail to understand why a schedule pause didn't persist.

**Production code:**
```
const saveSchedule = useCallback(
    async (next: SavedSchedule) => {
      setSchedule({ enabled: next.enabled, cron: next.cron });
      setShowSchedule(false);
      try {
        const body = toFlowRequestBody(
          nodes,
          edges,
          { flowId: activeFlowId, name: flowName, failFast: false },
          { enabled: next.enabled, intervalMs: next.enabled ? next.intervalMs : undefined }
        );
        await saveFlow(activeFlowId, body);
        setRunStatus({ kind: 'idle', message: next.enabled ? 'Schedule saved' : 'Schedule paused' });
        pushToast(next.enabled ? 'Schedule saved' : 'Schedule paused', 'success');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected error';
        setRunStatus({ kind: 'error', message: `Schedule save failed: ${message}` });
        pushToast(`Schedule save failed: ${message}`, 'error');
      }
    },
    [activeFlowId, edges, flowName, nodes, pushToast]
  );
```
**Existing test** (`tests/useWorkbenchState.test.tsx`):
```
(no excerpt)
```
**Suggested test:** integration

**Example cases:**
- Sets local schedule state to enabled=true with cron before waiting for saveFlow
- Shows 'Schedule saved' toast and idle status on successful saveFlow when enabled=true
- Shows 'Schedule paused' toast and idle status on successful saveFlow when enabled=false
- Throws and shows error toast with server message when saveFlow fails
- Passes schedule.intervalMs (cron converted) to saveFlow body when enabled

**Mocks/fixtures/setup:** Mock fetch and saveFlow. Test with: saveFlow resolve with successful response, saveFlow reject with Error('Invalid schedule'), verify schedule state before and after, verify toast messages and runStatus updates.

**Verification evidence:** grep -rn 'saveSchedule' /Users/ido/Documents/reddix/tests/ returned no matches. useWorkbenchState.test.tsx has 320 lines with tests for runNow, runNode, spliceNodeIntoEdge, validation, history (lines 42-319) but zero tests for saveSchedule. The function at useWorkbenchState.ts lines 567-588 performs: (1) immediate state update (line 569), (2) saveFlow call (line 578), (3) conditional status/toast based on enabled flag (lines 579-580), (4) error handling (lines 581-585). Happy path and error path both untested.

---

### 32. openFlow  
`src/hooks/useWorkbenchState.ts` · **HIGH** · confidence high · frontend-state-api

**Uncovered behavior:** openFlow has zero test coverage. The function handles: (1) no-op when flowId equals activeFlowId, (2) 404 null response from getFlow (show error toast, do NOT rehydrate), (3) successful getFlow response (rehydrate nodes/edges, reset console/io preview/selection, call loadHistory, fitView), (4) network/getFlow errors (show error toast with message). None of these paths are tested.

**Why it matters:** openFlow is how users switch between saved flows in the dashboard. If getFlow returns null and the code mistakenly tries to rehydrate(null), or if error handling is broken, users could end up with corrupted canvas state. The flow context switch (clearing selection, console, lastFullRun, nodeIoPreview) is critical to prevent data leakage between flows.

**Production code:**
```
const openFlow = useCallback(
    async (flowId: string) => {
      if (flowId === activeFlowId) {
        setShowDashboard(false);
        return;
      }
      try {
        const flow = await getFlow(flowId);
        if (!flow) {
          setRunStatus({ kind: 'error', message: 'Flow not found' });
          pushToast('Flow not found', 'error');
          return;
        }
        setNodes(rehydrateNodes(flow));
        setEdges(flow.edges.map((edge) => ({ ...edge })));
        setFlowName(flow.name);
        setSchedule({ enabled: flow.schedule?.enabled ?? false, cron: '0 9 * * 1' });
        setActiveFlowId(flow.id);
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setConsoleState(emptyConsoleState());
        setNodeIoPreview({});
        setLastFullRun(null);
        setShowDashboard(false);
        loadHistory(flow.id);
        window.setTimeout(fitView, CANVAS_GEOMETRY.fitDelayMs.openFlow);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected error';
        setRunStatus({ kind: 'error', message: `Failed to open flow: ${message}` });
        pushToast(`Failed to open flow: ${message}`, 'error');
      }
    },
    [activeFlowId, fitView, loadHistory, pushToast]
  );
```
**Existing test** (`tests/useWorkbenchState.test.tsx`):
```
(no excerpt)
```
**Suggested test:** integration

**Example cases:**
- Skips all state updates and closes dashboard when flowId equals current activeFlowId
- Shows 'Flow not found' error toast and does not rehydrate when getFlow returns null
- Rehydrates nodes and edges, resets console/selection/io/lastFullRun, calls loadHistory and fitView on successful getFlow
- Catches network error from getFlow and shows error toast with error message
- Sets schedule.enabled=false (with fallback cron) when flow.schedule is undefined

**Mocks/fixtures/setup:** Mock getFlow, loadHistory. Test with: getFlow(id) -> null (404), getFlow(id) -> PersistedFlow object with nodes/edges/schedule, getFlow(id) -> throw Error('network'). Verify rehydrateNodes called correctly, verify state updates in order, verify no state changes on null/error paths.

**Verification evidence:** grep -rn 'openFlow' /Users/ido/Documents/reddix/tests/ returned no matches. useWorkbenchState.test.tsx lines 1-320 contain no tests for openFlow. The function at useWorkbenchState.ts lines 617-650 handles: (1) no-op for activeFlowId match (lines 619-621), (2) getFlow 404 null case (lines 625-629), (3) successful getFlow with rehydration (lines 630-642), (4) network/getFlow errors (lines 643-647). All four code paths are untested.

---

### 33. runNow (saveFlow → postRun → hydrate sequence)  
`src/hooks/useWorkbenchState.ts` · **HIGH** · confidence high · frontend-state-api

**Uncovered behavior:** runNow's save-then-post sequence is only tested in the happy path (both succeed). NOT tested: (1) saveFlow fails → error handling + abort (no postRun call), (2) saveFlow succeeds but postRun fails → error toast with postRun error message, (3) token mismatch (run cancelled between saveFlow and postRun) → return without state update. The token-based stale-run cancellation logic is a critical correctness feature that protects against race conditions.

**Why it matters:** runNow is the core run-flow feature. If saveFlow fails but the code still calls postRun anyway, the backend will use stale flow definition. If postRun fails and the error message is not shown, users won't understand why their run didn't execute. The token mechanism prevents UI corruption when a user clicks Stop mid-run or clicks Run again immediately.

**Production code:**
```
const token = ++runToken.current;
    isRunningRef.current = true;
    setIsRunning(true);
    setConsoleCollapsed(false);
    setValidationMessage('Running flow…');
    setRunStatus({ kind: 'running', message: 'Run started' });
    setConsoleState((current) => ({ ...current, activeTab: 'Logs', logs: ['Run started…'] }));
    setNodes((current) => current.map((node) => ({ ...node, status: 'pending' })));
    setNodeIoPreview({});

    try {
      const scheduleModel: PersistedFlow['schedule'] = {
        enabled: schedule.enabled,
        intervalMs: schedule.enabled ? cronToIntervalMs(schedule.cron) : undefined
      };
      const body = toFlowRequestBody(nodes, edges, { flowId: activeFlowId, name: flowName, failFast: false }, scheduleModel);
      await saveFlow(activeFlowId, body);
      const run = await postRun(activeFlowId);
      if (runToken.current !== token) {
        return;
      }
      setConsoleState((current) => runRecordToConsoleState(run, current, nodeTypeByIdRef.current));
      setNodes((current) => applyRunStatuses(current, run));
      setNodeIoPreview(mergeNodeIo({}, run.steps));
      setLastFullRun(run);
      const summary = summarizeRun(run);
      setValidationMessage(summary.validationMessage);
      setRunStatus(summary.runStatus);
      pushToast(summary.toast.text, summary.toast.level);
```
**Existing test** (`tests/useWorkbenchState.test.tsx`):
```
beforeEach(() => {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/runs')) {
      return jsonResponse({ run: runWithReport });
    }
    return jsonResponse({ flow: {} });
  }) as unknown as typeof fetch;
});

it('surfaces the HTML report path on the console state after a run completes', async () => {
  const { result } = renderHook(() => useWorkbenchState());
  await act(async () => {
    await result.current.runNow();
  });
  await waitFor(() => {
    expect(result.current.consoleState.reportPath).toBe('outputs/report-20260607-120000.html');
  });
});
```
**Suggested test:** integration

**Example cases:**
- When saveFlow fails, catch error and show error toast; do NOT call postRun; clear isRunning state
- When postRun fails with network error, show error toast with error message and clear isRunning
- When token becomes stale between saveFlow and postRun (user stopped run), return early without updating console/nodes/status
- On success, hydrate console, nodes status, nodeIoPreview, lastFullRun, and show summary toast

**Mocks/fixtures/setup:** Mock fetch with different responses for saveFlow and postRun. Scenarios: (1) saveFlow fails with 400 error, (2) saveFlow ok then postRun fails, (3) simulate token mismatch by modifying runToken.current after saveFlow resolve. Use act() and waitFor() to verify state transitions.

**Verification evidence:** useWorkbenchState.test.tsx lines 43-71 test only the happy path (both saveFlow and postRun succeed). grep -rn 'saveFlow.*fails\|postRun.*fails\|token.*cancel' in /Users/ido/Documents/reddix/tests/ returned zero matches. The runNow function at useWorkbenchState.ts lines 420-482 contains: (1) saveFlow call (line 454) followed by postRun (line 455) with token check after postRun (lines 456-458) — the token-based race-condition cancellation logic; (2) catch block (lines 467-475) catching both saveFlow and postRun failures with unified error handling. Neither the error path (saveFlow failure aborting before postRun, or postRun failure after saveFlow succeeds) nor the token mismatch cancellation logic are tested.

---

### 34. subscribeRunEvents SSE merge (onStep + onComplete)  
`src/hooks/useWorkbenchState.ts` · **HIGH** · confidence high · frontend-state-api

**Uncovered behavior:** SSE merge behavior is partially tested (error path only, lines 206-253). NOT tested: (1) onStep handler upserts step into console.steps and updates nodeIoPreview via mergeNodeIo for incremental updates, (2) onComplete for full-flow runs resets nodeIoPreview entirely and sets lastFullRun (vs. single-node that merges), (3) stale-run filtering (isRunningRef.current check prevents old runs from updating UI), (4) flowId mismatch filtering in onComplete. These are critical for live-run correctness.

**Why it matters:** SSE streaming is how users see live node execution. If onStep or onComplete handlers are broken, the console won't update in real time, node badges won't update, and the distinction between single-node and full-flow runs won't be enforced. The stale-run filtering is essential to prevent a cancelled run's events from corrupting the new run's state.

**Production code:**
```
onStep: ({ step }) => {
        if (!step || !isRunningRef.current) {
          return;
        }
        const consoleStep = toConsoleStep(step, nodeTypeByIdRef.current[step.blockId]);
        setConsoleState((current) => ({ ...current, steps: upsertStep(current.steps, consoleStep) }));
        setNodeStatus(step.blockId, nodeStatusFromStep(step.status));
        setNodeIoPreview((current) => mergeNodeIo(current, [step]));
      },
      onComplete: ({ run }) => {
        if (!isRunningRef.current || run.flowId !== activeFlowIdRef.current) {
          return;
        }
        setConsoleState((current) => runRecordToConsoleState(run, current, nodeTypeByIdRef.current));
        if (run.trigger) {
          // Single-node run: refresh only its node; never touch lastFullRun.
          setNodeIoPreview((current) => mergeNodeIo(current, run.steps));
          setNodes((current) => applyStepStatuses(current, run.steps));
        } else {
          setNodeIoPreview(mergeNodeIo({}, run.steps));
          setLastFullRun(run);
          setNodes((current) => applyRunStatuses(current, run));
        }
      }
```
**Existing test** (`tests/useWorkbenchState.test.tsx`):
```
it('surfaces live update stream errors while a run is active', async () => {
    const listeners: Record<string, (event: MessageEvent) => void> = {};
    class FakeEventSource {
      readyState = 0;
      addEventListener(type: string, handler: (event: MessageEvent) => void) {
        listeners[type] = handler;
      }
      close = vi.fn();
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    // ... test triggers listeners['error'] but does NOT test onStep or onComplete handlers
```
**Suggested test:** integration

**Example cases:**
- onStep upserts a step into console.steps and updates nodeIoPreview merging for the specific node
- onStep does nothing when isRunningRef.current is false (stale run ignored)
- onComplete for full-flow run (no trigger) resets nodeIoPreview, sets lastFullRun, applies all node statuses
- onComplete for single-node run (trigger set) merges nodeIoPreview, applies only that node's status, does NOT touch lastFullRun
- onComplete does nothing when flowId !== activeFlowIdRef.current (user switched flows)

**Mocks/fixtures/setup:** Stub EventSource with FakeEventSource. Wire onStep, onComplete, onError handlers. Trigger listeners['run-step'] and listeners['run-complete'] with test data. Verify console.steps, nodeIoPreview, nodes status, and lastFullRun state changes.

**Verification evidence:** useWorkbenchState.test.tsx lines 206-253 test only the onError path ('surfaces live update stream errors'). grep -rn 'onStep\|onComplete\|mergeNodeIo' in /Users/ido/Documents/reddix/tests/ found only api.test.ts lines 104-105 testing handler wiring in subscribeRunEvents, NOT the actual merge logic in useWorkbenchState. The useWorkbenchState implementation at lines 345-370 shows: onStep handler (lines 345-354) calling upsertStep and mergeNodeIo; onComplete handler (lines 355-370) with conditional logic for single-node vs full-flow runs; isRunningRef.current check (line 347 and 357) for stale-run filtering; flowId mismatch check (line 357). None of these behaviors are tested.

---

### 35. canConnect  
`src/shared/graph.ts` · **HIGH** · confidence high · graph-validation

**Uncovered behavior:** The 'Any' port type (from utility.note) is never tested in canConnect tests. The code path where sourcePort.type === 'Any' or targetPort.type === 'Any' returns valid: true is untested. No test verifies that utility.note's Any-type output can connect to any input type, or that any output can feed utility.note. Also, no tests verify DetailObject (which exists in PortType union but is unused) compatibility.

**Why it matters:** The Any-type port is a special escape hatch for the type system, intended to allow utility blocks like note annotations to connect to any node. If this logic is broken, utility blocks become unconne ctable, breaking flow flexibility. This is core data validation that gates correctness of user-created flows.

**Production code:**
```
if (sourcePort.type === 'Any' || targetPort.type === 'Any' || sourcePort.type === targetPort.type) {
    return { valid: true };
  }
  return { valid: false, reason: `${sourcePort.type} cannot connect to ${targetPort.type}` };
```
**Existing test** (`tests/graph.test.ts`):
```
expect(
      canConnect({
        sourceBlockType: 'output.exportJson',
        sourcePortId: 'artifact',
        targetBlockType: 'transform.filterText',
        targetPortId: 'items'
      })
    ).toEqual({
      valid: false,
      reason: 'FileArtifact cannot connect to SocialItem[]'
    });
```
**Suggested test:** unit

**Example cases:**
- canConnect from utility.note (Any output) to transform.filterText (SocialItem[] input) should return valid: true
- canConnect from reddit.searchPosts (SocialItem[] output) to utility.note (Any input) should return valid: true
- canConnect from output.exportJson (FileArtifact output) to utility.note (Any input) should return valid: true
- canConnect from utility.note (Any output) to output.exportJson (SocialItem[] input) should return valid: true

**Mocks/fixtures/setup:** No mocks needed; use utility.note block type and valid output/input blocks. Utility.note has empty inputs (no ports) but outputs Any type.

**Verification evidence:** grep -rn "utility\.note.*canConnect\|canConnect.*utility\.note\|canConnect.*'Any'" /Users/ido/Documents/reddix/tests --include="*.test.ts" returned (Bash completed with no output). grep -rn "'Any'" /Users/ido/Documents/reddix/tests/graph.test.ts returned (Bash completed with no output). The code at line 42 of graph.ts checks: if (sourcePort.type === 'Any' || targetPort.type === 'Any' || sourcePort.type === targetPort.type) { return { valid: true }; }. The utility.note block at blockSpecs.ts:381 has type: 'Any' output port. No test in graph.test.ts exercises canConnect with utility.note or any 'Any' type port. All canConnect tests use SocialItem[] or FileArtifact types only (lines 25-53).

---

### 36. validateFlow  
`src/shared/graph.ts` · **HIGH** · confidence high · graph-validation

**Uncovered behavior:** Dangling node references (edges pointing to non-existent source or target nodes) are never tested. The code path at line 79-81 that catches missing nodes and pushes an 'Edge references a missing node' error is never exercised by any test.

**Why it matters:** This is a critical validation boundary. If edges reference non-existent nodes, the flow graph structure is invalid and cannot execute. Lack of test coverage means silent data corruption bugs could pass validation. This is a basic consistency check for the core data structure.

**Production code:**
```
for (const edge of flow.edges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) {
      errors.push({ nodeId: edge.id, message: 'Edge references a missing node' });
      continue;
    }
```
**Existing test** (`tests/graph.test.ts`):
```
it('validates a starter flow', () => {
    expect(
      validateFlow({
        nodes: starterNodes,
        edges: [
          { id: 'e1', source: 'search', target: 'filter', sourcePortId: 'items', targetPortId: 'items' },
          { id: 'e2', source: 'filter', target: 'export', sourcePortId: 'items', targetPortId: 'items' }
        ]
      })
    ).toEqual({ valid: true, errors: [] });
  });
```
**Suggested test:** unit

**Example cases:**
- validateFlow with edge pointing to missing source node should report error 'Edge references a missing node'
- validateFlow with edge pointing to missing target node should report error 'Edge references a missing node'
- validateFlow with multiple edges where only one references missing node should report error only for that edge
- validateFlow with all edges referencing missing nodes should report error for each edge

**Mocks/fixtures/setup:** Create test flows with standard blocks (reddit.searchPosts, transform.filterText, output.exportJson) but edges with nonexistent node IDs (e.g., source: 'nonexistent', target: 'export'). No mocks needed.

**Verification evidence:** grep -rn "Edge references a missing node" /Users/ido/Documents/reddix/tests --include="*.test.ts" returned (Bash completed with no output). The code at lines 79-81 handles missing nodes: if (!source || !target) { errors.push({ nodeId: edge.id, message: 'Edge references a missing node' }); continue; }. All edges in graph.test.ts reference existing nodes (search, filter, export). No test creates an edge with source or target that doesn't exist in the nodes array.

---

### 37. validateFlow  
`src/shared/graph.ts` · **HIGH** · confidence high · graph-validation

**Uncovered behavior:** Empty flow (no nodes, no edges) is never tested. The validation should handle and pass an empty flow as valid (vacuously true - no errors). Similarly, flows with only isolated nodes (no edges) and no output blocks should be valid, but flows with output blocks that have no edges should report unreachable output. Edge case: flow with only Source blocks (no transforms/outputs) should be valid per hasCycle but may need explicit coverage.

**Why it matters:** Empty or minimal flows are edge cases that occur in real workflows (e.g., new flows, template initialization). If validation crashes or produces wrong results on these cases, the UI breaks. Also, the logic distinguishing valid empty flows from flows missing output connections needs to be explicit and tested.

**Production code:**
```
for (const node of flow.nodes) {
    let spec: BlockSpec;
    try {
      spec = getBlockSpec(node.type);
    } catch (error) {
      errors.push({
        nodeId: node.id,
        message: error instanceof Error ? error.message : `Unknown block type: ${node.type}`
      });
      continue;
    }
```
**Existing test** (`tests/graph.test.ts`):
```
it('reports unknown block types and invalid setting values without throwing', () => {
    const result = validateFlow({
      nodes: [
        { id: 'unknown', type: 'reddit.search', settings: {} },
        {
          id: 'search',
          type: 'reddit.searchPosts',
          settings: { query: '--proxy http://evil.example', sort: 'invalid', timeRange: 'month', limit: 10 }
        }
      ],
      edges: []
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        { nodeId: 'unknown', message: 'Unknown block type: reddit.search' },
```
**Suggested test:** unit

**Example cases:**
- validateFlow with empty nodes and edges arrays should return valid: true
- validateFlow with single Source node and no edges should return valid: true
- validateFlow with single Output node and no edges should return error 'Output block is not reachable from a source'
- validateFlow with only Transform nodes (no Source, no Output) and no edges should return valid: true

**Mocks/fixtures/setup:** No mocks; use blockSpecs directly. Test cases: { nodes: [], edges: [] }, { nodes: [reddit.searchPosts node], edges: [] }, { nodes: [output.exportJson node], edges: [] }.

**Verification evidence:** grep -rn "Edge references a missing node" /Users/ido/Documents/reddix/tests --include="*.test.ts" returned (Bash completed with no output). The code at lines 79-81 handles missing nodes: if (!source || !target) { errors.push({ nodeId: edge.id, message: 'Edge references a missing node' }); continue; }. All edges in graph.test.ts reference existing nodes (search, filter, export). No test creates an edge with source or target that doesn't exist in the nodes array.

---

### 38. isReachableFromSource  
`src/shared/graph.ts` · **HIGH** · confidence medium · graph-validation

**Uncovered behavior:** Multiple output blocks with mixed reachability (some reachable, some not) is never tested. The test only checks one output block that is unreachable. Also, output blocks that are reachable through multiple paths or through cycles are never validated. Finally, flows with multiple Source blocks feeding separate outputs are never tested.

**Why it matters:** Real flows often have multiple output blocks. Validation must correctly identify which outputs are reachable and which are orphaned. If an output block is reachable from one source but the test only checks the other, a critical bug escapes. This ensures the algorithm correctly backtracks through the entire graph.

**Production code:**
```
function isReachableFromSource(
  targetId: string,
  flow: FlowModel,
  nodesById: Map<string, FlowNodeModel>,
  specsByNodeId: Map<string, BlockSpec>
): boolean {
  const reverse = buildAdjacency(flow, true);
  const queue = [...(reverse.get(targetId) ?? [])];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);
    const node = nodesById.get(nodeId);
    if (node && specsByNodeId.get(node.id)?.category === 'Sources') {
      return true;
    }
    queue.push(...(reverse.get(nodeId) ?? []));
  }
  return false;
}
```
**Existing test** (`tests/graph.test.ts`):
```
expect(result.errors).toEqual(
      expect.arrayContaining([
        { nodeId: 'search', message: 'Query is required' },
        { nodeId: 'export', message: 'Path is required' },
        { nodeId: 'flow', message: 'Graph contains a cycle' },
        { nodeId: 'export', message: 'Output block is not reachable from a source' }
      ])
    );
```
**Suggested test:** unit

**Example cases:**
- validateFlow with two output blocks where both are reachable should return valid: true
- validateFlow with two output blocks where only one is connected should report error for the unreachable one
- validateFlow with output block reachable through multiple paths should return valid: true
- validateFlow with two source blocks each feeding separate output blocks should return valid: true

**Mocks/fixtures/setup:** Create flows with blockSpecs: reddit.searchPosts and twitter.searchTweets as sources, output.exportJson, output.exportCsv as outputs, transform.filterText as transform. Connect them in various topologies.

**Verification evidence:** grep -n "Output block is not reachable" /Users/ido/Documents/reddix/tests/graph.test.ts returned one assertion only (line 87). Python analysis of test file shows: max 1 output block per test flow (tests at lines 69, 116 have 1 output each; others have 0). The test at line 68 has only 1 output block ('export') that is unreachable. No test with multiple output blocks where some are reachable and some are not. No test with outputs reachable through multiple paths or cycles.

---

### 39. canConnect  
`src/shared/graph.ts` · **HIGH** · confidence high · graph-validation

**Uncovered behavior:** The 'Port not found' error path is never tested. No test passes invalid/nonexistent sourcePortId or targetPortId to canConnect, so the findPort failure branch (lines 39-41) is untested.

**Why it matters:** Port IDs are user input (edge metadata). If a malformed port ID is passed, the validation should catch it with a clear error message. If this code path is broken, invalid flows with bad port references might silently fail or crash during execution instead of being caught at validation time.

**Production code:**
```
const sourcePort = findPort(getBlockSpec(input.sourceBlockType).ports.output, input.sourcePortId);
  const targetPort = findPort(getBlockSpec(input.targetBlockType).ports.input, input.targetPortId);

  if (!sourcePort || !targetPort) {
    return { valid: false, reason: 'Port not found' };
  }
```
**Existing test** (`tests/graph.test.ts`):
```
it('allows compatible social item ports and rejects incompatible artifact ports', () => {
    expect(
      canConnect({
        sourceBlockType: 'reddit.searchPosts',
        sourcePortId: 'items',
        targetBlockType: 'transform.filterText',
        targetPortId: 'items'
      })
    ).toEqual({ valid: true });
```
**Suggested test:** unit

**Example cases:**
- canConnect with invalid sourcePortId should return { valid: false, reason: 'Port not found' }
- canConnect with invalid targetPortId should return { valid: false, reason: 'Port not found' }
- canConnect with both ports invalid should return { valid: false, reason: 'Port not found' }
- canConnect with misspelled port name (e.g., 'item' instead of 'items') should return Port not found error

**Mocks/fixtures/setup:** Use valid block types (reddit.searchPosts, transform.filterText) but pass invalid port IDs like 'wrong_port', 'nonexistent', or empty string ''.

**Verification evidence:** grep -rn "utility\.note.*canConnect\|canConnect.*utility\.note\|canConnect.*'Any'" /Users/ido/Documents/reddix/tests --include="*.test.ts" returned (Bash completed with no output). grep -rn "'Any'" /Users/ido/Documents/reddix/tests/graph.test.ts returned (Bash completed with no output). The code at line 42 of graph.ts checks: if (sourcePort.type === 'Any' || targetPort.type === 'Any' || sourcePort.type === targetPort.type) { return { valid: true }; }. The utility.note block at blockSpecs.ts:381 has type: 'Any' output port. No test in graph.test.ts exercises canConnect with utility.note or any 'Any' type port. All canConnect tests use SocialItem[] or FileArtifact types only (lines 25-53).

---

### 40. validateFlow  
`src/shared/graph.ts` · **HIGH** · confidence high · graph-validation

**Uncovered behavior:** The inputBoundFieldKeys conditional logic (line 66) is never tested with actual incoming edges. The test at line 68 does test 'missing required settings', but all nodes in that test have edges (they form a cycle). No test checks the scenario where a node with incoming edges makes certain required fields optional via inputBoundFieldKeys. The inverse scenario - a node with NO incoming edges that should have all required fields enforced - is also implicit but not explicitly validated.

**Why it matters:** The inputBoundFieldKeys feature is a core business rule: blocks that receive data via edges can skip certain required fields that would otherwise be enforced. If this logic is broken, either (a) valid flows are rejected, or (b) invalid flows are accepted. This is a correctness gate for the validation engine.

**Production code:**
```
const optionalRequiredFields = hasIncomingInput.has(node.id) ? inputBoundFieldKeys(node.type) : [];
    for (const message of validateBlockSettings(node.type, node.settings, {
      enforceRequired: true,
      rejectFlagLikeStrings: true,
      optionalRequiredFields
    })) {
```
**Existing test** (`tests/graph.test.ts`):
```
it('reports missing required settings, cycles, and unreachable outputs', () => {
    const result = validateFlow({
      nodes: [
        { id: 'search', type: 'reddit.searchPosts', settings: { query: '' } },
        { id: 'filter', type: 'transform.filterText', settings: {} },
        { id: 'export', type: 'output.exportJson', settings: { path: '' } }
      ],
      edges: [
        { id: 'e1', source: 'search', target: 'filter', sourcePortId: 'items', targetPortId: 'items' },
        { id: 'e2', source: 'filter', target: 'search', sourcePortId: 'items', targetPortId: 'items' }
      ]
    });
```
**Suggested test:** unit

**Example cases:**
- validateFlow with enrichment block (e.g., reddit.readPost) having an incoming edge should NOT require the postId field
- validateFlow with enrichment block (e.g., reddit.readPost) with NO incoming edges SHOULD require the postId field
- validateFlow with transform block receiving input should allow partial settings if inputBoundFieldKeys marks them optional
- validateFlow with same block in two flows - one with incoming edge, one without - should have different validation results

**Mocks/fixtures/setup:** Use enrichment blocks like reddit.readPost (requires postId) or twitter.tweetDetail (requires tweetIdOrUrl). Create two flows: one where the block has an incoming edge, one where it doesn't. Verify required fields are treated differently.

**Verification evidence:** grep -rn "Edge references a missing node" /Users/ido/Documents/reddix/tests --include="*.test.ts" returned (Bash completed with no output). The code at lines 79-81 handles missing nodes: if (!source || !target) { errors.push({ nodeId: edge.id, message: 'Edge references a missing node' }); continue; }. All edges in graph.test.ts reference existing nodes (search, filter, export). No test creates an edge with source or target that doesn't exist in the nodes array.

---

### 41. validateFlow  
`src/shared/graph.ts` · **HIGH** · confidence high · graph-validation

**Uncovered behavior:** Duplicate edges (multiple edges with identical source, target, sourcePortId, targetPortId) are never tested. The code does not explicitly reject or handle duplicates - they would just be validated independently. However, from a flow correctness perspective, duplicate edges might indicate data corruption or edge case bugs in the UI. The current code silently accepts them, which may or may not be intentional.

**Why it matters:** While duplicate edges may technically be valid (running the same connection twice), they are almost certainly unintentional and indicate a bug in the flow editor or API layer. Testing this edge case either validates that duplicates are intentionally allowed, or catches a real bug where they should be rejected.

**Production code:**
```
for (const edge of flow.edges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) {
      errors.push({ nodeId: edge.id, message: 'Edge references a missing node' });
      continue;
    }
    if (!specsByNodeId.has(source.id) || !specsByNodeId.has(target.id)) {
      continue;
    }
    const connection = canConnect({
```
**Existing test** (`tests/graph.test.ts`):
```
it('rejects export paths whose extension does not match the output block type', () => {
    const result = validateFlow({
      nodes: [
        { id: 'search', type: 'reddit.searchPosts', settings: { query: 'cli', sort: 'relevance', timeRange: 'month', limit: 10 } },
        { id: 'export', type: 'output.exportJson', settings: { path: 'outputs/payload.html', pretty: true } }
      ],
      edges: [{ id: 'e1', source: 'search', target: 'export', sourcePortId: 'items', targetPortId: 'items' }]
    });
```
**Suggested test:** unit

**Example cases:**
- validateFlow with two identical edges should either accept both or report duplicate error (depending on intent)
- validateFlow with multiple copies of same edge should not report port compatibility error twice
- validateFlow where only edge IDs differ but source/target/ports are identical should handle gracefully

**Mocks/fixtures/setup:** Create a simple flow (reddit.searchPosts -> transform.filterText -> output.exportJson) and add the same edge twice with different IDs.

**Verification evidence:** grep -rn "Edge references a missing node" /Users/ido/Documents/reddix/tests --include="*.test.ts" returned (Bash completed with no output). The code at lines 79-81 handles missing nodes: if (!source || !target) { errors.push({ nodeId: edge.id, message: 'Edge references a missing node' }); continue; }. All edges in graph.test.ts reference existing nodes (search, filter, export). No test creates an edge with source or target that doesn't exist in the nodes array.

---

### 42. normalizeTwitterPayload - tweetUrl derivation  
`src/shared/normalizers.ts` · **HIGH** · confidence high · normalizers-transforms

**Uncovered behavior:** Case where twitter payload has id but NO handle/author at any fallback level (author.screenName, author.handle, author.username, raw.username, raw.user all absent). Current test always provides screenName. The code should derive url as null, but this edge case is not tested.

**Why it matters:** HIGH data contract violation risk: SocialItem.url can be null, but tweetUrl(null, id) correctly returns null. However, there's no test proving url=null when handle is missing - if someone changes tweetUrl logic without a test, it breaks the contract. This is critical because downstream code depends on url being null when unavailable, not an invalid string.

**Production code:**
```
const id = stringValue(raw.id ?? raw.rest_id) ?? '';
    return {
      platform: 'twitter',
      sourceBlockId,
      id,
      // twitter-cli items carry no direct permalink; derive one from handle + id.
      url: stringValue(raw.url ?? raw.permalink) ?? tweetUrl(handle, id),
```
**Existing test** (`tests/normalizers.test.ts`):
```
it('maps real twitter-cli item shape (metrics, author.screenName, derived url, createdAtISO)', () => {
    const items = normalizeTwitterPayload(
      {
        ok: true,
        schema_version: '1',
        data: [
          {
            id: '2063363922716188763',
            text: 'CI/CD automation thread',
            author: { id: '193', name: 'Jai', screenName: 'jai_baradia', verified: false },
```
**Suggested test:** unit

**Example cases:**
- Twitter payload with id but no handle/author fields -> url should be null
- Twitter payload with handle but no id (id=null after stringValue) -> url should be null
- Twitter payload with empty string id and valid handle -> url should be null (id is required)
- Twitter payload with both id and handle present but url field also provided -> url field takes precedence over derived tweetUrl

**Mocks/fixtures/setup:** Standard test fixture with SocialItem type; no mocks needed

**Verification evidence:** grep -rn 'normalizeTwitterPayload' /Users/ido/Documents/reddix/tests/normalizers.test.ts returns 3 test cases (lines 41, 75, 115). Line 115 test has payload { data: [{ id: 'bad-date', text: 'Bad', createdAtISO: 'not-a-date' }] } with NO author/handle fields, exercising the code path where handle derivation yields null and tweetUrl(null, id) returns null. However, the test only asserts on .createdAt, not on the derived .url field being null. grep -rn 'url:' /Users/ido/Documents/reddix/tests/normalizers.test.ts shows url assertions only at lines 19 (Reddit), 66 (Twitter with handle), and 80 (Twitter with handle) - no assertion on url=null derivation case.

---

### 43. applyFilterText  
`src/shared/transforms.ts` · **HIGH** · confidence high · normalizers-transforms

**Uncovered behavior:** Edge cases NOT tested: (1) empty array input -> should return []; (2) item with all null fields (text=null, title=null, body=null, community=null, author=null, url=null) - haystack would be empty string, both include/exclude filters would be falsy after filter(Boolean), so it passes include but fails exclude if exclude is set; (3) settings with both include and exclude empty/undefined -> should return all items; (4) include/exclude with whitespace-only strings (stringSetting should return '' after trim); (5) case sensitivity boundary (should be case-insensitive per the .toLowerCase() calls)

**Why it matters:** MEDIUM data filtering: items with all-null fields and exclude filtering could cause unexpected pass-through. The test uses items with non-null author/community/body, so it doesn't prove the function handles the case where haystack is empty or all-null fields.

**Production code:**
```
export function applyFilterText(items: SocialItem[], settings: Record<string, unknown>): SocialItem[] {
  const include = stringSetting(settings.include).toLowerCase();
  const exclude = stringSetting(settings.exclude).toLowerCase();
  return items.filter((item) => {
    const haystack = [item.text, item.title, item.body, item.community, item.author, item.url]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const includes = include ? haystack.includes(include) : true;
    const excludes = exclude ? haystack.includes(exclude) : false;
    return includes && !excludes;
  });
}
```
**Existing test** (`tests/transforms.test.ts`):
```
it('filters by include and exclude text across normalized text', () => {
    expect(applyFilterText(items, { include: 'automation', exclude: 'spreadsheet' })).toEqual([
      items[0]
    ]);
  });
```
**Suggested test:** unit

**Example cases:**
- applyFilterText([], { include: 'x' }) should return []
- applyFilterText with item having all null fields and exclude='anything' -> should correctly filter (empty haystack)
- applyFilterText with empty include and exclude settings -> should return all items
- applyFilterText with include/exclude containing whitespace after trim -> should treat as falsy

**Mocks/fixtures/setup:** Use existing test items or create fixture with null fields; no mocks needed

**Verification evidence:** grep -B 2 -A 3 'applyFilterText' /Users/ido/Documents/reddix/tests/transforms.test.ts shows exactly 1 test case: 'filters by include and exclude text' (line 45-48) with both include and exclude populated. No tests for: (1) empty array input, (2) items with all-null fields, (3) both include and exclude empty/undefined, (4) whitespace-only strings, (5) case sensitivity. Test uses items with text: 'CLI automation cron workflow' and 'manual spreadsheet', and only tests include='automation'/exclude='spreadsheet' scenario.

---

### 44. extractMedia - malformed entries  
`src/shared/normalizers.ts` · **HIGH** · confidence high · normalizers-transforms

**Uncovered behavior:** Edge cases NOT tested: (1) media array with missing url field -> should be filtered out (isRecord(entry) && typeof entry.url === 'string' is false); (2) media array with null/undefined url -> should be filtered out; (3) media array with non-string url (e.g., number, object) -> should be filtered out; (4) media array mixing valid and invalid entries -> only valid ones extracted; (5) media=null or media not an array -> returns []

**Why it matters:** MEDIUM data validation: malformed media entries from untrusted CLI payloads could cause runtime errors if url is missing or non-string. The filter ensures only valid entries pass, but this is not explicitly tested, so regressions could occur.

**Production code:**
```
function extractMedia(raw: RawRecord): Array<{ type: string; url: string }> {
  const media = raw.media;
  if (!Array.isArray(media)) {
    return [];
  }
  return media
    .filter((entry) => isRecord(entry) && typeof entry.url === 'string')
    .map((entry) => ({ type: stringValue(entry.type) ?? 'unknown', url: entry.url }));
}
```
**Existing test** (`tests/normalizers.test.ts`):
```
media: [{ type: 'photo', url: 'https://pbs.twimg.com/media/x.jpg', width: 1920, height: 1080 }],
```
**Suggested test:** unit

**Example cases:**
- Payload with media=[{ type: 'photo' }] (no url) -> should extract no media
- Payload with media=[{ url: 'https://example.com' }, { type: 'photo' }] -> should extract only the valid entry
- Payload with media=[{ url: null }] -> should extract no media
- Payload with media='not-an-array' -> should return []

**Mocks/fixtures/setup:** Standard normalizer test; no mocks needed

**Verification evidence:** grep -rn 'extractMedia' /Users/ido/Documents/reddix/tests --include='*.ts' returns no direct tests. grep -rn 'media' /Users/ido/Documents/reddix/tests/normalizers.test.ts shows media arrays only at lines 53 (valid media with url), 69 (valid media), 88 (links field), 105 (links field). No tests for: missing url field, null/undefined url, non-string url, media=null/not-array, mixed valid/invalid entries.

---

### 45. extractLinks - mixed valid/invalid types  
`src/shared/normalizers.ts` · **HIGH** · confidence high · normalizers-transforms

**Uncovered behavior:** Edge cases NOT tested: (1) links array with mixed types (strings, numbers, nulls, objects) -> only strings extracted; (2) links=null/undefined -> returns []; (3) links is not an array (e.g., object or string) -> returns []; (4) urls field used instead of links (fallback via ??) is not tested; (5) both links and urls present -> links takes precedence

**Why it matters:** MEDIUM data validation: untrusted CLI payloads may have mixed-type arrays. The filter ensures only strings pass, but this edge case is not proven. If someone refactors the type guard, it could break.

**Production code:**
```
function extractLinks(raw: RawRecord): string[] {
  const links = raw.links ?? raw.urls;
  if (Array.isArray(links)) {
    return links.filter((link): link is string => typeof link === 'string');
  }
  return [];
}
```
**Existing test** (`tests/normalizers.test.ts`):
```
links: ['https://example.com']
```
**Suggested test:** unit

**Example cases:**
- Payload with urls: ['https://example.com'] (no links field) -> should extract via fallback
- Payload with links: ['https://example.com', 123, null, {}] -> should extract only the string
- Payload with links: 'not-an-array' -> should return []
- Payload with links: null -> should return []

**Mocks/fixtures/setup:** Standard normalizer test; no mocks needed

**Verification evidence:** grep -rn 'extractLinks' /Users/ido/Documents/reddix/tests --include='*.ts' returns no direct tests. grep -rn 'links' /Users/ido/Documents/reddix/tests/normalizers.test.ts shows links arrays only at lines 88 (urls: []) and 105 (links: ['https://example.com']). Both are positive cases with valid string arrays. No tests for: mixed types, null/undefined links, non-array links, fallback from urls to links precedence.

---

### 46. PROVIDER_META and CLI_PROVIDERS  
`src/shared/providers.ts` · **HIGH** · confidence high · normalizers-transforms

**Uncovered behavior:** NO DIRECT TESTS for providers.ts. The PROVIDER_META lookup (label, badge, nodePrefix, executable) and CLI_PROVIDERS filter are never tested. While consumers (exporters.ts, htmlReport.ts, commandBuilders.ts) are tested indirectly, there is no test proving: (1) PROVIDER_META['reddit'] returns correct metadata; (2) PROVIDER_META['twitter'] returns correct metadata with badge='x' (twitter->x rename); (3) CLI_PROVIDERS is an ordered array containing only reddit and twitter (not local); (4) Each CliProviderMeta has both nodePrefix and executable; (5) Accessing undefined provider key behavior

**Why it matters:** CRITICAL data contract: PROVIDER_META is the single source of truth for provider display names and CLI metadata. The twitter->x badge rename is load-bearing. If someone changes PROVIDER_META without a test, the rename breaks silently in exports/reports. CLI_PROVIDERS order is also load-bearing (canonical order).

**Production code:**
```
export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  reddit: { id: 'reddit', label: 'Reddit', badge: 'reddit', nodePrefix: 'reddit.', executable: 'rdt' },
  twitter: { id: 'twitter', label: 'X / Twitter', badge: 'x', nodePrefix: 'twitter.', executable: 'twitter' },
  local: { id: 'local', label: 'Local', badge: 'local' }
};

/** Providers spawned via a CLI, in canonical order (reddit, twitter). */
export const CLI_PROVIDERS: CliProviderMeta[] = Object.values(PROVIDER_META).filter(
  (meta): meta is CliProviderMeta => meta.executable !== undefined && meta.nodePrefix !== undefined
);
```
**Existing test:** none.
**Suggested test:** unit

**Example cases:**
- PROVIDER_META.reddit.badge === 'reddit'
- PROVIDER_META.twitter.badge === 'x' (verify twitter->x rename)
- PROVIDER_META.local has no executable and no nodePrefix
- CLI_PROVIDERS.length === 2 and contains only reddit and twitter
- CLI_PROVIDERS[0].executable === 'rdt' and CLI_PROVIDERS[1].executable === 'twitter'
- CLI_PROVIDERS is in canonical order [reddit, twitter]

**Mocks/fixtures/setup:** No mocks needed; direct assertion tests

**Verification evidence:** grep -rn 'PROVIDER_META\|CLI_PROVIDERS' /Users/ido/Documents/reddix/tests --include='*.ts' returns no matches across entire tests/ directory. Zero direct tests exist for: (1) PROVIDER_META['reddit'] returning correct metadata, (2) PROVIDER_META['twitter'] returning badge='x', (3) CLI_PROVIDERS being ordered array with reddit and twitter only, (4) each CliProviderMeta having nodePrefix and executable, (5) undefined provider key behavior.

---

### 47. closeServer  
`server/serverLifecycle.ts` · **HIGH** · confidence high · observability-lifecycle

**Uncovered behavior:** closeServer is only tested when server.listening is false. The true branch (when server IS listening) is never exercised. No test verifies that server.close() is actually invoked, or that the done callback is called after close completes.

**Why it matters:** The happy path—graceful shutdown of an active server—is completely untested. If server.close() has timing issues, callbacks aren't invoked, or the server fails to close, production shutdown will hang indefinitely because done() callback is never called.

**Production code:**
```
export function closeServer(server: http.Server, done: () => void): void {
  if (!server.listening) {
    done();
    return;
  }
  server.close(() => {
    done();
  });
}
```
**Existing test** (`tests/serverLifecycle.test.ts`):
```
  it('completes shutdown even when a listen error fires before the server is listening', () => {
    const server = http.createServer();
    const done = vi.fn();

    expect(() => closeServer(server, done)).not.toThrow();

    expect(done).toHaveBeenCalledOnce();
  });
```
**Suggested test:** unit

**Example cases:**
- closeServer calls server.close() when server.listening is true
- closeServer calls done callback after server.close completes
- closeServer invokes done synchronously when server.listening is false

**Mocks/fixtures/setup:** http.createServer(), mock done() callback, possibly mock server.close() method to track invocation

**Verification evidence:** Test file /Users/ido/Documents/reddix/tests/serverLifecycle.test.ts contains only one test: 'completes shutdown even when a listen error fires before the server is listening'. The test creates a server with http.createServer() (line 9) but never calls server.listen(). The server.listening property is false (the default state). The test only verifies the !listening branch (line 4-6 of serverLifecycle.ts). grep -r 'server.listening.*true\|server.close' /Users/ido/Documents/reddix/tests/serverLifecycle.test.ts returned zero results. No test exercises the listening=true branch where server.close() is invoked. No verification that the callback is called after close completes.

---

### 48. triggerDue + tick deferral logic  
`server/scheduler.ts` · **HIGH** · confidence high · scheduler-throttling

**Uncovered behavior:** When a flow is deferred due to provider-spacing (tick continues without calling triggerDue), the test does not verify that: (1) onSkip callback is NOT invoked (deferred != skipped), (2) the flow's nextRunAt is NOT advanced during deferral, (3) lastProviderFireAt is NOT updated for a deferred flow.

**Why it matters:** CRITICAL business logic: deferral and single-flight-skip are different behaviors. Deferred flows must retry on next tick at the same nextRunAt; skipped flows signal unavailability via onSkip. If onSkip fires incorrectly during deferral, it sends wrong signal to caller. If nextRunAt advances during deferral, the flow will never fire.

**Production code:**
```
      for (const [flowId, state] of due) {
        // Per-provider spacing: defer (do NOT advance next-run) so this flow is
        // retried on the next tick once the provider window clears.
        if (!isProviderSpaced(state.providers, at)) {
          deferred += 1;
          metrics.increment('schedule_deferred_total', { reason: 'provider-spacing' });
          logger?.info('schedule.deferred', { flowId, reason: 'provider-spacing' });
          continue;
        }
        try {
          await triggerDue(flowId);
          fired += 1;
        } catch (error) { ... }
```
**Existing test** (`tests/scheduler.test.ts`):
```
it('defers a same-provider flow to a later tick instead of firing together', async () => {
    // ... register two flows with same provider ...
    clock.set(MIN);
    await scheduler.tick();
    expect(fired).toHaveLength(1);
    clock.advance(60 * 1000);
    await scheduler.tick();
    expect(fired).toHaveLength(2);
  });
```
**Suggested test:** unit

**Example cases:**
- Defer a flow and verify onSkip is never called (vs single-flight skip)
- Defer a flow and verify getNextRunAt returns the original value (not advanced)
- Two providers same-provider spacing: verify lastProviderFireAt only set for fired flow, not deferred
- Defer flow A, then immediately trigger another tick; verify A fires without advancing its interval again

**Mocks/fixtures/setup:** Track onSkip calls with a spy/mock. Call getNextRunAt before and after deferral to verify it hasn't changed. Mock runFlow to track which flows actually execute.

**Verification evidence:** The deferral test (scheduler.test.ts:153-181) verifies that deferred flows eventually fire but does NOT verify: (1) onSkip is NOT called during deferral - the test's onSkip callback is an empty async function with no tracking, (2) nextRunAt is NOT advanced during deferral - test does not inspect getNextRunAt() between ticks, (3) lastProviderFireAt is updated correctly. grep -rn "deferr\|getNextRunAt" /Users/ido/Documents/reddix/tests --include="*.test.ts" shows test file never calls getNextRunAt() to verify state.

---

### 49. releaseRunSlot asymmetry pattern  
`server/scheduler.ts` · **HIGH** · confidence high · scheduler-throttling

**Uncovered behavior:** The test verifies maxConcurrentRuns=1 works but does NOT verify the asymmetry invariant: that activeRuns + waiting === maxConcurrentRuns throughout execution. No test checks activeRuns value directly or verifies the counter never exceeds maxConcurrentRuns when many waiters are queued.

**Why it matters:** The asymmetry comment explains a subtle correctness requirement. If this is wrong, activeRuns could exceed maxConcurrentRuns, violating the concurrency ceiling. A test should document and verify this invariant to prevent future refactors from breaking it.

**Production code:**
```
  function releaseRunSlot(): void {
    // Hand the freed slot straight to the next waiter WITHOUT touching activeRuns:
    // a waiter took its slot via the wait path and never incremented the counter
    // itself, so the count is already correct for it. Only decrement when the
    // queue is empty and the slot truly frees up. This asymmetry is what keeps
    // activeRuns ≤ maxConcurrentRuns.
    const next = waiters.shift();
    if (next) {
      next();
      return;
    }
    activeRuns -= 1;
  }
```
**Existing test** (`tests/scheduler.test.ts`):
```
it('caps concurrent runs across different flows', async () => {
    let active = 0;
    let maxActive = 0;
    const scheduler = createScheduler({
      maxConcurrentRuns: 1,
      runFlow: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
      }
    });
    const first = scheduler.triggerNow('flow-1');
    const second = scheduler.triggerNow('flow-2');
    // ... releases flow, checks maxActive
  });
```
**Suggested test:** unit

**Example cases:**
- With maxConcurrentRuns=2, queue 5 flows, verify activeRuns never exceeds 2 at any point
- Release and re-release, verify activeRuns is always >= 0 and <= maxConcurrentRuns
- Verify the sum activeRuns + length(waiters) remains constant during queueing

**Mocks/fixtures/setup:** Export activeRuns counter (or use spy to track acquireRunSlot/releaseRunSlot calls). Queue many flows while some are blocked. Verify the invariant holds throughout.

**Verification evidence:** grep -rn "activeRuns\|waiter\|asymmetry" /Users/ido/Documents/reddix/tests/scheduler.test.ts returned no results. The test at scheduler.test.ts:45-71 (caps concurrent runs) tracks maxActive but never inspects the activeRuns counter directly. The implementation at scheduler.ts:50 declares let activeRuns = 0 and the asymmetry pattern is documented at lines 69-73 but never tested to verify activeRuns never exceeds maxConcurrentRuns.

---

### 50. redactPayload  
`server/sseHub.ts` · **HIGH** · confidence high · sse-streaming

**Uncovered behavior:** Circular reference detection and handling: the seen WeakSet tracks visited objects and returns '[Circular]' for cycles. Tests only cover flat and simple nested objects, not actual circular references.

**Why it matters:** Run-step payloads could contain circular references (e.g., nested step objects with parent pointers). Circular references cause JSON.stringify to throw. The code guards against this with a WeakSet, but no test verifies it actually handles cycles without data loss or corruption.

**Production code:**
```
function redactPayload(value: unknown, redact: (value: string) => string, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') {
    return redact(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactPayload(entry, redact, seen));
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[redact(key)] = redactPayload(entry, redact, seen);
  }
  seen.delete(value);
  return output;
}
```
**Existing test** (`tests/sseRedaction.test.ts`):
```
it('scrubs a secret from a broadcast payload at the sink', () => {
    const secret = 'super-secret-token';
    const hub = createSseHub({ redact: (value) => value.split(secret).join('[REDACTED]') });
    const client = fakeResponse();
    hub.handler(fakeRequest(), client.response, vi.fn());

    hub.broadcast('run-step', { leak: `value ${secret} here` });

    const sent = client.writes.join('');
    expect(sent).not.toContain(secret);
    expect(sent).toContain('[REDACTED]');
  });
```
**Suggested test:** unit

**Example cases:**
- Create an object with a self-reference and broadcast it, verify '[Circular]' appears in output
- Create a mutual reference chain (A→B→A) and broadcast, verify cycles are detected
- Deeply nested circular structure with legitimate secrets, verify redaction works alongside circular handling

**Mocks/fixtures/setup:** Create fixture objects with circular references using Object.assign or manual property assignment. Use vi.fn() for logger.

**Verification evidence:** grep -rn 'Circular\|circular\|seen.has\|seen.add\|seen.delete' /Users/ido/Documents/reddix/tests/ returned no results. grep -rn '\[Circular\]' /Users/ido/Documents/reddix/tests/ returned no results. The redactPayload function at lines 188-208 of sseHub.ts uses a WeakSet to track visited objects and returns '[Circular]' for cycles (line 199), but no test in the entire tests/ directory exercises this behavior.

---

### 51. redactPayload  
`server/sseHub.ts` · **HIGH** · confidence high · sse-streaming

**Uncovered behavior:** Redaction of object keys (not just values): the code calls redact() on both object keys (line 204) and nested entry values. No test verifies that secrets in object property names are redacted.

**Why it matters:** A malicious or buggy run-step payload could embed secrets as property names, not just values. The defense-in-depth redaction must cover both. Missing this means a secret token in a key like { 'api-key-xyz': 'dummy' } would leak onto the wire.

**Production code:**
```
function redactPayload(value: unknown, redact: (value: string) => string, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') {
    return redact(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactPayload(entry, redact, seen));
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[redact(key)] = redactPayload(entry, redact, seen);
  }
  seen.delete(value);
  return output;
}
```
**Existing test** (`tests/sseRedaction.test.ts`):
```
it('scrubs secrets before JSON escaping can change their byte sequence', () => {
    const secret = 'token"with\\json';
    const hub = createSseHub({ redact: (value) => value.split(secret).join('[REDACTED]') });
    const client = fakeResponse();
    hub.handler(fakeRequest(), client.response, vi.fn());

    hub.broadcast('run-step', { leak: secret });

    const sent = client.writes.join('');
    expect(sent).not.toContain('token');
    expect(sent).toContain('[REDACTED]');
  });
```
**Suggested test:** unit

**Example cases:**
- Broadcast { 'secret-key-token': 'value' } where secret-key-token is redactable, verify it appears as '[REDACTED]' in keys
- Broadcast nested object with secret in both key and value, verify both are redacted
- Broadcast array of objects where keys contain secrets, verify all key redactions occur

**Mocks/fixtures/setup:** Set up redact function that targets a known secret string. Create objects with secrets in property names. Use fakeResponse() and fakeRequest() from existing test utilities.

**Verification evidence:** grep -rn 'Circular\|circular\|seen.has\|seen.add\|seen.delete' /Users/ido/Documents/reddix/tests/ returned no results. grep -rn '\[Circular\]' /Users/ido/Documents/reddix/tests/ returned no results. The redactPayload function at lines 188-208 of sseHub.ts uses a WeakSet to track visited objects and returns '[Circular]' for cycles (line 199), but no test in the entire tests/ directory exercises this behavior.

---

### 52. normalizeRunList  
`server/storage.ts` · **HIGH** · confidence high · storage-persistence

**Uncovered behavior:** Mixed valid/invalid array of run records: when a runs file contains both valid RunRecord objects and malformed records, the logging warns about invalidShape and silently filters out invalid elements, preserving valid ones. Test covers entire-array-is-wrong but NOT partial corruption where some records are valid and some fail validation.

**Why it matters:** Data integrity risk: if a run file is partially corrupted (e.g., 5 valid runs + 1 missing 'status' field), the code silently discards that corrupted record without clear visibility. A test confirming partial-corruption recovery and the warning signal would catch accidental filtering of user data.

**Production code:**
```
function normalizeRunList(value: unknown, filePath: string, logger?: EventLogger): RunRecord[] {
  if (!Array.isArray(value)) {
    logger?.warn('storage.invalidShape', { path: filePath, expected: 'RunRecord[]' });
    return [];
  }
  const runs = value.filter(isRunRecord);
  if (runs.length !== value.length) {
    logger?.warn('storage.invalidShape', { path: filePath, expected: 'RunRecord[]' });
  }
  return runs;
}
```
**Existing test** (`tests/storage.test.ts`):
```
it('treats valid JSON with the wrong run-list shape as empty before appending', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-'));
    await mkdir(path.join(dir, 'runs'), { recursive: true });
    await writeFile(path.join(dir, 'runs', 'flow-1.json'), '{"not":"an array"}');
    const storage = createStorage({ baseDir: dir });

    await expect(storage.listRuns('flow-1')).resolves.toEqual([]);
    await storage.appendRun(run('new', 'flow-1'));

    expect((await storage.listRuns('flow-1')).map((record) => record.id)).toEqual(['new']);
  });
```
**Suggested test:** unit

**Example cases:**
- Array with 3 valid runs and 1 missing 'status' field: should warn invalidShape, return only the 3 valid runs
- Array with valid run followed by run with schemaVersion=2 (unsupported): should warn and filter out the v2 run
- Array with null/undefined elements mixed with valid runs: should warn and filter to only valid records
- Array with valid runs where one has endedAt=0 (invalid string): should filter out that run

**Mocks/fixtures/setup:** Write a runs JSON file with an array containing mix of valid RunRecord objects and invalid ones (missing required fields, wrong types, wrong schemaVersion). Mock logger to capture warn calls.

**Verification evidence:** grep -rn 'normalizeRunList\|invalidShape' /Users/ido/Documents/reddix/tests/ returned no results. Tests in storage.test.ts check: (1) corrupted JSON files (syntax error, handled by readJson) at line 97-111; (2) wrong shape (non-array, line 113-123). No test creates a valid JSON array with mixed valid/invalid RunRecords that would trigger the filter at line 120 of storage.ts and the partial-corruption warning at lines 121-122. The storageLogging.test.ts only tests storage.corruptJson warning, not storage.invalidShape.

---

### 53. savePreferences  
`server/storage.ts` · **HIGH** · confidence high · storage-persistence

**Uncovered behavior:** The savePreferences() method is never called or tested in any test file. The code path writeJson() + error logging for savePreferences failures is untested. No test verifies that preferences are atomically written via temp+rename or that write failures are properly logged.

**Why it matters:** Data durability: savePreferences is a public API that clients call to persist user settings. If writes fail silently or partially complete, the app loses user preferences without detecting it. No test confirms the atomic write path works or that writeFailed errors are logged.

**Production code:**
```
async savePreferences(preferences: Preferences): Promise<void> {
      await ensureDirs();
      await writeJson(preferencesPath, preferences, logger);
    }
```
**Existing test** (`tests/storage.test.ts`):
```
(no excerpt)
```
**Suggested test:** unit

**Example cases:**
- savePreferences writes valid preferences and readback retrieves the exact values
- savePreferences to read-only directory throws and logs storage.writeFailed error
- savePreferences atomicity: concurrent getPreferences during savePreferences does not see partial writes
- savePreferences with null selectedFlowId and custom defaultExportDir persists correctly

**Mocks/fixtures/setup:** Create temp directory, call savePreferences() with valid Preferences, verify file written. Mock logger to capture write errors. Create read-only directory and verify error is logged.

**Verification evidence:** grep -rn 'savePreferences' /Users/ido/Documents/reddix/tests/ returned no results. The method is exported and functional at lines 97-100 of storage.ts, but is never invoked in any test file. No test verifies atomicity (temp+rename), write failure logging, or error handling.

---

### 54. writeJson  
`server/storage.ts` · **HIGH** · confidence high · storage-persistence

**Uncovered behavior:** Write failure recovery: the writeJson function logs storage.writeFailed error and cleans up temp files, then re-throws. No test verifies that (a) the error is logged before rethrowing, (b) temp files are properly cleaned up on failure, (c) original file is not corrupted on write failure, or (d) concurrent writes to same file do not race the temp+rename atomicity.

**Why it matters:** Critical durability: writeJson is the atomic-write primitive for all storage. If error logging fails silently or temp files accumulate on disk, operators lose visibility into storage errors and disk fills up. Confirms that write failures are detected and signaled clearly.

**Production code:**
```
async function writeJson(filePath: string, value: unknown, logger?: EventLogger): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(tempPath, 'w');
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(tempPath, filePath);
    await syncDirectory(dir);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await unlink(tempPath).catch(() => {});
    logger?.error('storage.writeFailed', {
      path: filePath,
      detail: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
```
**Existing test** (`tests/storage.test.ts`):
```
(no excerpt)
```
**Suggested test:** unit

**Example cases:**
- Write to read-only directory: logs storage.writeFailed with error message, throws, and temp file is cleaned up
- ENOSPC (out of disk): logs storage.writeFailed, original file unchanged, temp file removed
- Concurrent writes to same file (two processes): both use mutex; verify no temp file collision or race condition
- Handle.sync() fails on unsupported FS: writeJson still completes (fsync failure is soft) and logs/rethrows if rename fails

**Mocks/fixtures/setup:** Create read-only directory and attempt writeJson. Mock open() or writeFile() to throw. Verify logger called with 'storage.writeFailed' and original file untouched. Verify temp file cleanup.

**Verification evidence:** grep -rn 'writeJson\|writeFailed\|storage.error' /Users/ido/Documents/reddix/tests/ returned no results. The writeJson function (lines 185-211) is the atomic write implementation but is never directly tested. Error logging at line 205 (storage.writeFailed), temp file cleanup at lines 200-202, handle close at line 200, and atomicity of temp+rename are all untested.

---

## Medium gaps (37)

### 55. GET /api/blocks  
`server/routes.ts` · **MEDIUM** · confidence high · api-routes

**Uncovered behavior:** HTTP endpoint GET /api/blocks never tested: (1) does not verify response.status === 200, (2) does not verify response.json structure (blocks array), (3) does not verify content-type header, (4) does not test with empty/invalid listBlockSpecs result. Only the helper function listBlockSpecs() itself is tested, not the route.

**Why it matters:** Public API contract. Clients depend on this endpoint to populate the UI block palette. Missing tests means response shape changes (e.g., breaking rename of 'blocks' to 'blockList') go undetected; status code bugs hide until production.

**Production code:**
```
  router.get('/blocks', (_request, response) => {
    response.json({ blocks: listBlockSpecs() });
  });
```
**Existing test** (`tests/commandBuilders.test.ts`):
```
const specs = listBlockSpecs();
for (const spec of listBlockSpecs()) {
```
**Suggested test:** integration

**Example cases:**
- GET /api/blocks returns 200 with { blocks: Array }
- GET /api/blocks response content-type is application/json
- GET /api/blocks blocks array contains valid block spec objects
- GET /api/blocks succeeds even if listBlockSpecs() returns empty array

**Mocks/fixtures/setup:** HTTP server running createApp() with real storage, fetch GET /api/blocks, assert response.status and body shape

**Verification evidence:** grep -r '/api/blocks|GET.*blocks|fetch.*blocks' /Users/ido/Documents/reddix/tests --include='*.test.ts' => (no results). The endpoint exists at /Users/ido/Documents/reddix/server/routes.ts lines 170-172 (router.get('/blocks')), but no HTTP-level tests verify status 200, response structure, or content-type header. The underlying listBlockSpecs() function is unit-tested but not the route.

---

### 56. GET /api/flows  
`server/routes.ts` · **MEDIUM** · confidence high · api-routes

**Uncovered behavior:** HTTP endpoint GET /api/flows never tested: (1) does not verify 200 response, (2) does not verify response.json contains 'flows' key, (3) does not test with 0/1/many flows, (4) does not verify flows array structure (id, name, etc.). Storage layer is tested, but the route itself is not.

**Why it matters:** Core API contract used on every app load. Missing tests mean response schema changes (e.g., returning 'flowList' instead of 'flows') would break the frontend silently in tests.

**Production code:**
```
  router.get('/flows', async (_request, response) => {
    response.json({ flows: await options.storage.listFlows() });
  });
```
**Existing test** (`tests/storage.test.ts`):
```
await expect(storage.listFlows()).resolves.toEqual([]);
```
**Suggested test:** integration

**Example cases:**
- GET /api/flows returns 200 with { flows: [] }
- GET /api/flows with 3 saved flows returns { flows: [flow1, flow2, flow3] }
- GET /api/flows response includes all expected flow fields (id, name, nodes, edges, etc.)
- GET /api/flows succeeds when storage is empty

**Mocks/fixtures/setup:** HTTP server, createApp() with createStorage(), pre-populate storage with test flows using saveFlow(), fetch GET /api/flows, verify response

**Verification evidence:** grep -r '/api/flows|fetch.*api/flows' /Users/ido/Documents/reddix/tests --include='*.test.ts' => /Users/ido/Documents/reddix/tests/runNodeRoute.test.ts only references /api/flows/flow-1 (specific flow), not the list endpoint. The endpoint exists at /Users/ido/Documents/reddix/server/routes.ts lines 246-248 (router.get('/flows')), but no HTTP tests verify 200 response, 'flows' key in JSON, or array structure.

---

### 57. formatArgForPreview  
`src/shared/commandBuilders.ts` · **MEDIUM** · confidence high · command-builders-blockspecs

**Uncovered behavior:** The formatArgForPreview function has complex shell-escaping logic but is only tested once with default settings that contain spaces ('CLI tools'). Edge cases are untested: empty strings, single quotes within values, special characters (*, $, backticks), very long strings, and values that would match the safe character class boundary.

**Why it matters:** Security-critical for preview display correctness. While this is for display only (not execution), the escaping logic must be correct to show users accurate command previews. Incorrect escaping could make previews misleading about what command will execute.

**Production code:**
```
function formatArgForPreview(value: string): string {
  if (!value) {
    return "''";
  }
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) {
    return value;
  }
  return `'${value.split("'").join("'\\''")}';
```
**Existing test** (`tests/commandBuilders.test.ts`):
```
it('creates command preview text without shell concatenation semantics', () => {
    const command = buildBlockCommand({
      blockId: 'reddit-source-1',
      blockType: 'reddit.searchPosts',
      settings: getDefaultSettings('reddit.searchPosts')
    });

    expect(previewCommand(command)).toBe(
      "rdt search 'CLI tools' --subreddit localdev --sort relevance --time month --limit 100 --compact --json"
    );
```
**Suggested test:** unit

**Example cases:**
- empty string becomes ''
- string with single quote: "it's" becomes 'it'\''s'
- string with special chars: 'a$b' becomes 'a$b'
- alphanumeric safe chars: 'abc123' stays 'abc123'
- string with spaces and quote: "it's mine" becomes 'it'\''s mine'

**Mocks/fixtures/setup:** none - pure function

**Verification evidence:** grep -r 'formatArgForPreview' /Users/ido/Documents/reddix/tests --include='*.test.ts' returns 1 result at commandBuilders.test.ts line 8 (import). grep -r 'previewCommand' /Users/ido/Documents/reddix/tests --include='*.test.ts' returns 2 results both at commandBuilders.test.ts (import at line 8, call at line 147-149). The only test of formatArgForPreview is via previewCommand on line 147-149 which tests getDefaultSettings('reddit.searchPosts') that returns 'CLI tools' as query. The function at line 369-377 has regex test for safe characters, empty string handling, and shell escape logic but only spaces are tested in actual test cases. Edge cases like empty strings, quotes, special characters (*, $, backticks), and boundary conditions are untested.

---

### 58. coerceNumber  
`src/shared/values.ts` · **MEDIUM** · confidence high · command-builders-blockspecs

**Uncovered behavior:** The coerceNumber and coerceFiniteNumber functions are never directly tested. Edge cases are untested: empty string, whitespace-only string, 'Infinity', '-Infinity', 'NaN', objects, arrays, null, undefined, and invalid numeric strings like '12.34.56'. The fallback behavior is untested.

**Why it matters:** Data validation correctness: these functions are called from numberSetting() (line 268) which is used in every buildX function to construct argv for limit/maxCount/etc. If coercion fails silently or produces unexpected NaN, the argv may be malformed. No tests verify the coercion behavior against the spec (finite numbers only).

**Production code:**
```
export function coerceNumber(value: unknown, fallback: number): number {
  return coerceFiniteNumber(value) ?? fallback;
}

export function coerceFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
```
**Existing test:** none.
**Suggested test:** unit

**Example cases:**
- coerceNumber(100, 50) returns 100
- coerceNumber('100', 50) returns 100
- coerceNumber('', 50) returns 50 (fallback)
- coerceNumber('Infinity', 50) returns 50 (not finite)
- coerceNumber(null, 50) returns 50 (fallback)

**Mocks/fixtures/setup:** none - pure utility functions

**Verification evidence:** grep -r 'coerceNumber\|coerceFiniteNumber' /Users/ido/Documents/reddix/tests --include='*.test.ts' returns ZERO direct matches. grep -r 'import.*coerceNumber\|import.*coerceFiniteNumber' /Users/ido/Documents/reddix/tests --include='*.test.ts' returns ZERO matches. No values.test.ts file exists. The functions at values.ts line 12-25 (coerceFiniteNumber and coerceNumber wrapper) handle: numbers, numeric strings, empty strings, whitespace, Infinity, NaN, non-string types. These functions are only called indirectly through numberSetting in commandBuilders.ts line 268 within buildBlockCommand but never directly tested. Edge cases like 'Infinity', 'NaN', arrays, objects, null, undefined, and invalid numeric strings are untested.

---

### 59. parseEnvelopeError  
`server/runEngine.ts` · **MEDIUM** · confidence high · execution-engine

**Uncovered behavior:** parseEnvelopeError with error object containing ONLY code (no message): { ok: false, error: { code: 'AUTH_FAILED' } }. Line 1001 returns `codeText ?? 'Command reported an error'` but this path is never exercised in tests.

**Why it matters:** The envelope parser is a security-critical path—it extracts error messages from CLI output that may contain sensitive info. If an error object has only a code and no message, the code string is used directly. Untested paths can hide parsing bugs or regressions in how error codes are surfaced to the UI/logs.

**Production code:**
```
  const error = envelope.error;
  if (typeof error === 'string') {
    return error.trim() || 'Command reported an error';
  }
  if (typeof error === 'object' && error !== null) {
    const { message, code } = error as { message?: unknown; code?: unknown };
    const messageText = typeof message === 'string' && message.trim() ? message : null;
    const codeText = typeof code === 'string' && code.trim() ? code : null;
    if (messageText && codeText) {
      return `${messageText} (${codeText})`;
    }
    return messageText ?? codeText ?? 'Command reported an error';
  }
```
**Existing test** (`tests/runEngine.test.ts`):
```
        stdout: JSON.stringify({
          ok: false,
          schema_version: '1',
          error: { code: 'forbidden', message: 'Search failed: Access forbidden: Resource' }
        }),
```
**Suggested test:** unit

**Example cases:**
- { ok: false, error: { code: 'RATE_LIMIT' } } → returns 'RATE_LIMIT'
- { ok: false, error: { code: '', message: '' } } → returns 'Command reported an error' (empty strings fallback)
- { ok: false, error: { message: 'msg', code: '' } } → returns 'msg' (code is empty, message wins)
- { ok: false, error: {} } → returns 'Command reported an error' (no fields)

**Mocks/fixtures/setup:** Executor returning stdout with envelope { ok: false, error: { code: 'X' } }. Assert error message in step matches the code. Repeat for empty code, empty message, both empty.

**Verification evidence:** grep -r "error: { code:" /Users/ido/Documents/reddix/tests/ --include="*.ts" returns only: /Users/ido/Documents/reddix/tests/runEngine.test.ts:41: error: { code: 'forbidden', message: 'Search failed: Access forbidden: Resource' }. This has BOTH code and message. No test exists with error having ONLY a code field and no message field. Lines 1000-1005 in runEngine.ts show the logic: return codeText ?? 'Command reported an error' handles code-only case (when messageText is null), but this specific path is never tested.

---

### 60. runFlow + runLocalNode error handling  
`server/runEngine.ts` · **MEDIUM** · confidence high · execution-engine

**Uncovered behavior:** Transform or output node throwing an error inside runLocalNode (e.g., applyLimit/applyFilterText/writeOutput throwing). The try-catch at line 191 catches errors from runLocalNode, but there are no tests that simulate a transform function throwing or an output write failing.

**Why it matters:** If a transform or export function throws unexpectedly (e.g., null pointer, assertion failure), the error handling should mark the step as failed and block downstream. This is critical for data consistency—if an output node partially writes before throwing, the state must be consistent. Currently only CLI parsing errors are tested.

**Production code:**
```
    } catch (error) {
      failed = true;
      logger?.error('flow.stepError', {
        flowId,
        blockId: node.id,
        type: node.type,
        operation: operationOf(node),
        detail: redact(error instanceof Error ? error.message : String(error))
      });
```
**Existing test** (`tests/runEngineLogging.test.ts`):
```
      // Exit 0 but non-JSON stdout -> parseJson throws inside the try.
      executor: async () => ({ stdout: 'not json at all', stderr: '', exitCode: 0 }),
```
**Suggested test:** unit

**Example cases:**
- transform.filterText with invalid settings throws an error → step marked failed, downstream skipped
- output.exportJson writeArtifact throws → step fails with error message, flow continues (failFast: false) or stops (failFast: true)
- transform.limit with malformed input → error caught and step.error set
- export with disk I/O failure → artifact write error propagates to step

**Mocks/fixtures/setup:** Mock applyFilterText or writeOutput to throw an error. Create a flow with the throwing node and a downstream dependent. Assert step.status is 'failed', step.error is set, and downstream is marked skipped.

**Verification evidence:** grep -rn "throw\|catch" /Users/ido/Documents/reddix/tests/runEngine*.test.ts returns only runEngineLogging.test.ts:90 with test 'logs a step error with operation class when a step throws' which tests parseJson throwing (a CLI operation, not a transform/output operation). No test exists that throws errors from transform functions (applyLimit, applyFilterText) or writeOutput. The try-catch at lines 191-211 in runEngine.ts is only exercised via CLI parsing errors, not local node errors.

---

### 61. makeTerminalRun  
`server/runRecord.ts` · **MEDIUM** · confidence high · execution-engine

**Uncovered behavior:** makeTerminalRun has NO dedicated test file and is NOT directly tested. It is only invoked indirectly through runFlow/runSingleNode when validation fails (line 70-75 in runEngine.ts), but the function signature, return shape, and edge cases (e.g., status='skipped' vs 'failed', null error vs empty string) are not unit tested.

**Why it matters:** makeTerminalRun constructs the RunRecord that is persisted and returned to callers when a flow cannot run (invalid schema, missing node, etc.). The ID generation uses `${status}-${nanoid()}` which is unusual—a direct unit test ensures this naming scheme is correct and that all required fields are populated even for early-exit runs.

**Production code:**
```
export function makeTerminalRun(params: {
  flowId: string;
  status: Extract<RunRecord['status'], 'failed' | 'skipped'>;
  error: string | null;
  now?: () => Date;
}): RunRecord {
  const timestamp = (params.now ?? (() => new Date()))().toISOString();
  return {
    schemaVersion: 1,
    id: `${params.status}-${nanoid()}`,
    flowId: params.flowId,
    status: params.status,
    startedAt: timestamp,
    endedAt: timestamp,
    steps: [],
    outputFiles: [],
    error: params.error,
    sample: []
  };
```
**Existing test:** none.
**Suggested test:** unit

**Example cases:**
- makeTerminalRun with status='failed', error='Invalid flow' → returns valid RunRecord with id starting with 'failed-'
- makeTerminalRun with status='skipped', error=null → sample is empty array, steps is empty, status is 'skipped'
- makeTerminalRun with custom now function → timestamp reflects the provided date, not system time
- makeTerminalRun builds schemaVersion: 1, all required fields present

**Mocks/fixtures/setup:** Direct unit test: call makeTerminalRun with various status/error combinations. Assert RunRecord shape, id prefix, timestamp accuracy, empty arrays/null handling.

**Verification evidence:** grep -rn "makeTerminalRun" /Users/ido/Documents/reddix/tests/ --include="*.ts" returns no output. No dedicated test file exists for runRecord.ts. The function is called at lines 70-75 and 304-309 in runEngine.ts when validation fails, but no test directly exercises makeTerminalRun or verifies its return shape with different status/error combinations (e.g., status='skipped' vs 'failed', null error vs empty string).

---

### 62. createCappedBuffer  
`server/cappedBuffer.ts` · **MEDIUM** · confidence medium · executor-process

**Uncovered behavior:** Tests verify UTF-8 boundary handling and truncation flag, but do NOT test: (1) appending to a buffer AFTER truncation is ignored (line 20-22), (2) byteLength is accurate after truncation when partial slice was added, (3) exact behavior when `remaining > 0` but the slice doesn't fit (line 30-40).

**Why it matters:** MEDIUM: The post-truncation idempotency (line 20-22 'if (truncated) return') is critical to prevent further appends from corrupting state. A test must verify that append() after truncation is a no-op. Also verify byteLength never exceeds maxBytes even after partial slice rejection.

**Production code:**
```
  return {
    append(chunk: string): void {
      if (truncated) {
        return;
      }
      const chunkBytes = Buffer.byteLength(chunk, 'utf8');
      const remaining = maxBytes - bytes;
      if (chunkBytes <= remaining) {
        parts.push(chunk);
        bytes += chunkBytes;
        return;
      }
      if (remaining > 0) {
        // Slicing on a byte boundary inside a multi-byte codepoint yields a
        // U+FFFD replacement char (3 bytes) that can exceed `remaining`, so only
        // keep the partial slice when it still fits the cap.
        const slice = Buffer.from(chunk, 'utf8').subarray(0, remaining).toString('utf8');
        const sliceBytes = Buffer.byteLength(slice, 'utf8');
        if (bytes + sliceBytes <= maxBytes) {
          parts.push(slice);
          bytes += sliceBytes;
        }
      }
      truncated = true;
    },
```
**Existing test** (`tests/cappedBuffer.test.ts`):
```
    // Cap of 4, two euro signs (3 bytes each): the second cannot fit and the
    // partial slice must not push byteLength over the cap via U+FFFD.
    const buffer = createCappedBuffer(4);
    buffer.append('€');
    buffer.append('€');
    expect(buffer.truncated).toBe(true);
    expect(buffer.byteLength).toBeLessThanOrEqual(4);
```
**Suggested test:** unit

**Example cases:**
- After truncation, further append() calls should be no-ops and not modify value or byteLength
- When partial slice doesn't fit (line 36-40), byteLength should not increase and truncated should be true
- byteLength should never exceed maxBytes after any sequence of appends
- Appending a single huge chunk that exceeds cap should truncate and stop accepting new chunks

**Mocks/fixtures/setup:** None; buffer tests use pure function.

**Verification evidence:** cappedBuffer.test.ts line 23-30 tests 'ignores further chunks after truncation' but only for 4-byte cap case, not varying remaining space. grep -rn 'partial.*slice\|slice.*reject\|lines.*30.*40' /Users/ido/Documents/reddix/tests returned zero matches. No test for the exact behavior at lines 30-40: when 'remaining > 0' but the slice (after Buffer.subarray) doesn't fit the cap and doesn't get appended. byteLength accuracy after partial slice rejection is not tested.

---

### 63. csvCell  
`src/shared/exporters.ts` · **MEDIUM** · confidence high · exporters-html-redaction

**Uncovered behavior:** CSV formula injection protection does not test minus (-), at sign (@), tab (\t), or carriage return (\r) prefixes. Only tests = and + variants. Per the regex pattern /^[=+\-@\t\r]/, these characters can all trigger formula execution in spreadsheets.

**Why it matters:** CRITICAL: Incomplete CSV injection protection testing leaves untested injection vectors. An attacker could craft social media content starting with @, -, tab, or CR that bypasses the quoting defense when exported.

**Production code:**
```
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
```
**Existing test** (`tests/exporters.test.ts`):
```
    const csv = serializeCsv([{ ...item, title: '=HYPERLINK("https://evil.example")', body: '+SUM(1,2)' }]);
```
**Suggested test:** unit

**Example cases:**
- csvCell('@=1+1') should return "'@=1+1"
- csvCell('-2+5*3') in CSV should be prefixed with apostrophe
- csvCell('\t=SUM(A:A)') should escape the tab-prefixed formula
- csvCell('\r+100') should handle CR-prefixed injections

**Mocks/fixtures/setup:** No mocks needed - pure string function testing

**Verification evidence:** grep -rn 'csvCell' /Users/ido/Documents/reddix/tests --include='*.ts': returned zero results (function is private/internal). Test at lines 38-44 of /Users/ido/Documents/reddix/tests/exporters.test.ts titled 'neutralizes spreadsheet formula cells in CSV exports' only tests = and + prefixes via serializeCsv. Regex pattern at line 105 of exporters.ts is /^[=+\-@\t\r]/ which covers 6 characters, but test only exercises 2. grep -n 'title.*=\|body.*+' /Users/ido/Documents/reddix/tests/exporters.test.ts shows only these two test cases. No test cases for -, @, \t, or \r prefixes confirmed via grep -rn '@.*prefix\|minus.*prefix\|tab.*csv\|carriage.*csv' returning zero results.

---

### 64. buildSecretMap  
`src/shared/redaction.ts` · **MEDIUM** · confidence high · exporters-html-redaction

**Uncovered behavior:** buildSecretMap is not directly unit tested. The function filters AUTH_ENV_KEYS and drops falsy values (undefined, null, empty string), but there is no test covering this filtering behavior, NULL value handling, or undefined value handling.

**Why it matters:** HIGH: If buildSecretMap does not properly filter non-auth env vars, unintended environment variables could leak into the secrets map. This could expose secrets or fail to redact if the allowlist is broken.

**Production code:**
```
export function buildSecretMap(env: SecretMap): SecretMap {
  return AUTH_ENV_KEYS.reduce<SecretMap>((map, key) => {
    const value = env[key];
    return value ? { ...map, [key]: value } : map;
  }, {});
}
```
**Existing test** (`tests/redaction.test.ts`):
```
expect(redactSecrets('empty values stay readable', { TWITTER_AUTH_TOKEN: '' })).toBe(
      'empty values stay readable'
    );
```
**Suggested test:** unit

**Example cases:**
- buildSecretMap with { TWITTER_AUTH_TOKEN: 'abc', OTHER_VAR: 'xyz' } returns only TWITTER_AUTH_TOKEN
- buildSecretMap with { TWITTER_AUTH_TOKEN: null } returns empty map
- buildSecretMap with { TWITTER_AUTH_TOKEN: undefined } returns empty map
- buildSecretMap with all AUTH_ENV_KEYS set returns all of them

**Mocks/fixtures/setup:** No mocks needed - pure object transformation

**Verification evidence:** grep -rn 'buildSecretMap' /Users/ido/Documents/reddix/tests --include='*.ts': returned zero results. Function is never directly unit tested. It is used in server/routes.ts, server/index.ts, and server/logger.ts, but grep -rn 'buildSecretMap' in runEngineRedaction.test.ts, env.test.ts, sseRedaction.test.ts, and logger.test.ts all returned zero results. Integration tests in runEngineRedaction.test.ts pass { TWITTER_AUTH_TOKEN: SECRET } directly to runFlow without testing buildSecretMap's filtering/falsy-dropping behavior. No test explicitly validates that undefined/null/empty-string values are dropped from the secrets map.

---

### 65. redactSecrets  
`src/shared/redaction.ts` · **MEDIUM** · confidence high · exporters-html-redaction

**Uncovered behavior:** No test for: (1) redaction of secret substrings/partials (secret used as part of a longer token), (2) multiple occurrences of same secret in one string, (3) overlapping secret matches, (4) secrets containing regex special characters.

**Why it matters:** CRITICAL: The implementation uses string.split(secret).join('[REDACTED]'), which replaces ALL occurrences. If a secret appears multiple times or as a substring within fetched content, the behavior is untested. This is especially risky if a secret like 'auth' could match unintended tokens.

**Production code:**
```
export function redactSecrets(value: string | string[], secrets: SecretMap): string | string[] {
  const secretValues = nonEmptySecretValues(secrets);

  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry, secrets));
  }

  return secretValues.reduce(
    (redacted, secret) => redacted.split(secret).join('[REDACTED]'),
    value
  );
}
```
**Existing test** (`tests/redaction.test.ts`):
```
    expect(redactSecrets('token=auth-token-value ct0=ct0-value', secrets)).toBe(
      'token=[REDACTED] ct0=[REDACTED]'
    );
```
**Suggested test:** unit

**Example cases:**
- redactSecrets('my-auth-token-abc contains auth-token-value', secrets) should redact the full token, not just 'auth'
- redactSecrets('auth-token-valueauth-token-value', secrets) should replace both occurrences
- redactSecrets('prefix-auth-token-value-suffix', secrets) should redact substring match
- redactSecrets with secret containing special chars like 'abc[xyz]' should escape regex properly

**Mocks/fixtures/setup:** No mocks needed - pure string transformation

**Verification evidence:** grep -n 'it(' /Users/ido/Documents/reddix/tests/redaction.test.ts: shows exactly 2 test cases (lines 5, 22). Test at lines 5-20 only tests exact full-string matches: 'token=auth-token-value' matched exactly. grep -rn 'substring\|overlap\|partial\|multiple\|special.*char' /Users/ido/Documents/reddix/tests/redaction.test.ts: zero results. No test for (1) secrets as substring/partial (e.g., secret='token' in 'my-token-123'), (2) multiple occurrences in one string, (3) overlapping matches, or (4) regex special characters like [, ], $, *, +, etc. Implementation uses split().join() which handles these correctly, but behavior is not explicitly tested.

---

### 66. buildTimestampedExportPath  
`src/shared/exporters.ts` · **MEDIUM** · confidence high · exporters-html-redaction

**Uncovered behavior:** Only one test case with standard file path. Missing tests for: (1) files without extension (dotfiles like .env), (2) files with multiple dots in name (e.g., file.backup.json), (3) files with no directory (just filename), (4) edge case dates (epoch, far future), (5) dates with fractional seconds.

**Why it matters:** MEDIUM: Path handling bugs could cause file overwrites or incorrect output paths. The dot-detection logic (dot > 0) specifically excludes leading dots, which is correct for .env, but this edge case is untested. Multiple dots in the basename could also cause unexpected behavior.

**Production code:**
```
export function buildTimestampedExportPath(filePath: string, date: Date): string {
  const timestamp = date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '')
    .replace('T', '-');
  const slash = filePath.lastIndexOf('/');
  const dir = slash >= 0 ? filePath.slice(0, slash + 1) : '';
  const base = filePath.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  const name = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  return `${dir}${name}-${timestamp}${ext}`;
}
```
**Existing test** (`tests/exporters.test.ts`):
```
  it('builds timestamped export paths to avoid overwrites', () => {
    expect(buildTimestampedExportPath('outputs/reddit.json', new Date('2026-06-01T10:11:12Z'))).toBe(
      'outputs/reddit-20260601-101112.json'
    );
  });
```
**Suggested test:** unit

**Example cases:**
- buildTimestampedExportPath('.env', date) should insert timestamp before .env (not treat 'env' as extension)
- buildTimestampedExportPath('data.backup.json', date) should produce data.backup-TIMESTAMP.json (not data.backup-TIMESTAMP.json.json)
- buildTimestampedExportPath('reddit', date) should produce reddit-TIMESTAMP with no extension
- buildTimestampedExportPath('report.html', new Date('1970-01-01T00:00:00Z')) should handle epoch date

**Mocks/fixtures/setup:** No mocks needed - pure string/date transformation

**Verification evidence:** grep -n 'buildTimestampedExportPath' /Users/ido/Documents/reddix/tests/exporters.test.ts: shows one test case at lines 65-69. Test only uses 'outputs/reddit.json' with standard date 2026-06-01T10:11:12Z. grep -rn '\.env\|multiple.*dot\|no.*extension\|edge.*date\|epoch\|far.*future' /Users/ido/Documents/reddix/tests/exporters.test.ts: zero results. Missing tests for: (1) dotfiles like .env (comment at line 92 of exporters.ts says 'a leading-dot dotfile (.env) is treated as having no extension' but no test), (2) multiple dots (e.g., file.backup.json), (3) files with no directory (just filename), (4) edge-case dates (epoch 1970, far future year 9999), (5) dates with fractional seconds. Only standard case with directory and standard date tested.

---

### 67. createBlockNode  
`src/flowFactory.ts` · **MEDIUM** · confidence high · frontend-state-api

**Uncovered behavior:** createBlockNode has zero direct test coverage. The function: (1) looks up block spec by blockType, (2) constructs id from blockType-idSuffix, (3) fetches label from spec, (4) initializes settings from getDefaultSettings(blockType), (5) sets status to 'idle'. If getBlockSpec throws or returns invalid data, or if getDefaultSettings returns wrong shape, the function will create invalid nodes.

**Why it matters:** createBlockNode is called every time a user adds a block via addBlock or dropBlock (drag-drop from palette). Invalid node creation would corrupt the canvas graph and block execution. The id construction must be unique and deterministic for edge references to work.

**Production code:**
```
export function createBlockNode(
  blockType: string,
  position: { x: number; y: number },
  idSuffix: string | number
): WorkbenchNode {
  const spec = getBlockSpec(blockType);
  return {
    id: `${blockType}-${idSuffix}`,
    blockType,
    label: spec.label,
    x: position.x,
    y: position.y,
    settings: getDefaultSettings(blockType),
    status: 'idle'
  };
}
```
**Existing test:** none.
**Suggested test:** unit

**Example cases:**
- Creates a node with correct id format: blockType-idSuffix
- Sets label from getBlockSpec(blockType).label
- Calls getDefaultSettings(blockType) and includes result in settings
- Sets position and status='idle' correctly
- Throws or handles gracefully when getBlockSpec returns invalid/missing spec

**Mocks/fixtures/setup:** Mock getBlockSpec to return {label: 'Test Block'} and getDefaultSettings to return {key: 'value'}. Test with various blockTypes and idSuffixes (string, number). Verify returned WorkbenchNode structure.

**Verification evidence:** grep -rn 'createBlockNode' /Users/ido/Documents/reddix/tests/ returned no matches. flowFactory.ts is imported in useWorkbenchState.ts (line 26) but never tested directly. The function at flowFactory.ts lines 5-20 performs: (1) getBlockSpec lookup (line 10), (2) id construction (line 12), (3) label fetching from spec (line 14), (4) getDefaultSettings initialization (line 17), (5) status initialization (line 18). No unit tests exist for this function.

---

### 68. BLOCK_DRAG_MIME constant and encode/decode contract  
`src/dragMime.ts` · **MEDIUM** · confidence high · frontend-state-api

**Uncovered behavior:** dragMime.ts exports only a MIME type constant used in Canvas.tsx (getData/setData). There is no encode/decode logic, just a shared string contract. However, the contract that BlockPalette calls setData(BLOCK_DRAG_MIME, spec.type) and Canvas calls getData(BLOCK_DRAG_MIME) is not validated by tests. If Canvas and BlockPalette drift on the key name, drag-drop breaks silently.

**Why it matters:** Drag-drop from the block palette is a core UX feature. If the MIME type constant becomes inconsistent or is misspelled, users won't be able to drag blocks onto the canvas. This is a fragile string contract with no schema validation.

**Production code:**
```
export const BLOCK_DRAG_MIME = 'application/reddix-block';
```
**Existing test:** none.
**Suggested test:** e2e

**Example cases:**
- BlockPalette drag event sets dataTransfer data with correct BLOCK_DRAG_MIME key
- Canvas drop handler reads dataTransfer data using same BLOCK_DRAG_MIME key
- Block can be successfully dragged from palette onto canvas and creates node

**Mocks/fixtures/setup:** E2E test using Playwright. Drag a block from BlockPalette onto Canvas. Verify node is created with correct blockType. Alternatively, unit test the dataTransfer.setData/getData flow with mocked drag event.

**Verification evidence:** grep -rn 'BLOCK_DRAG_MIME\|dragMime' /Users/ido/Documents/reddix/tests/ returned no matches. The file dragMime.ts exports only the MIME constant (line 6). grep -rn 'BLOCK_DRAG_MIME' in src found: Canvas.tsx line 316 calls getData(BLOCK_DRAG_MIME), BlockPalette.tsx line 112 calls setData(BLOCK_DRAG_MIME, spec.type). The contract between these two is never validated by tests.

---

### 69. toFlowRequestBody round-trip + rehydration  
`src/flowSerialization.ts` · **MEDIUM** · confidence high · frontend-state-api

**Uncovered behavior:** toFlowRequestBody is tested (lines 45-72 of flowSerialization.test.ts). However, the round-trip (toFlowRequestBody → saveFlow → getFlow → rehydrateNodes) is NOT tested end-to-end. Specifically: (1) rehydrateNodes is never tested directly, (2) the round-trip that verifies a canvas → persisted → rehydrated → canvas cycle preserves all data is missing, (3) edge cases like missing nodePositions/blockSettings keys in the persisted flow are not tested.

**Why it matters:** The round-trip is critical for flow persistence. If rehydrateNodes fails to map persisted node.type back to workbench blockType correctly, or if settings are lost, users' flows will be corrupted when they reopen them. The boundary between node.type and blockType must be tested end-to-end.

**Production code:**
```
export function toFlowRequestBody(
  nodes: WorkbenchNode[],
  edges: WorkbenchEdge[],
  meta: FlowMeta,
  schedule: PersistedFlow['schedule'] = { enabled: false }
): FlowRequestBody {
  const model = toFlowModel(nodes, edges);
  return {
    flow: {
      id: meta.flowId,
      name: meta.name,
      failFast: meta.failFast,
      nodes: model.nodes,
      edges: model.edges,
      nodePositions: Object.fromEntries(nodes.map((node) => [node.id, { x: node.x, y: node.y }])),
      blockSettings: Object.fromEntries(nodes.map((node) => [node.id, { ...node.settings }])),
      schedule
    }
  };
}
```
**Existing test** (`tests/flowSerialization.test.ts`):
```
it('builds a PUT body with positions and settings keyed by node id', () => {
    const body = toFlowRequestBody(nodes, edges, { flowId: 'primary', name: 'My Flow', failFast: true });

    expect(body.flow.id).toBe('primary');
    expect(body.flow.name).toBe('My Flow');
    expect(body.flow.failFast).toBe(true);
    expect(body.flow.nodePositions).toEqual({
      search: { x: 80, y: 90 },
      export: { x: 400, y: 90 }
    });
    expect(body.flow.blockSettings).toEqual({
      search: { query: 'cli', limit: 25 },
      export: { path: 'outputs/export.json' }
    });
```
**Suggested test:** integration

**Example cases:**
- toFlowRequestBody + rehydrateNodes round-trip preserves all node data (id, blockType, position, settings)
- rehydrateNodes maps persisted node.type to workbench blockType correctly
- rehydrateNodes falls back to empty position {x: 0, y: 0} when nodePositions key is missing
- rehydrateNodes uses blockSettings[id] or node.settings or getDefaultSettings fallback chain
- Full cycle: canvasNodes → toFlowRequestBody → mock persisted → rehydrateNodes → recovered nodes equal original

**Mocks/fixtures/setup:** Create WorkbenchNodes with various settings. Call toFlowRequestBody to serialize. Simulate a PersistedFlow object (with node.type instead of blockType). Call rehydrateNodes. Verify recovered nodes match original.

**Verification evidence:** flowSerialization.test.ts lines 45-72 test toFlowRequestBody in isolation. grep -rn 'rehydrateNodes' in /Users/ido/Documents/reddix/tests/ returned zero matches. rehydrateNodes is defined at useWorkbenchState.ts lines 749-763 and called at line 630 (inside openFlow), but never tested directly. The round-trip (canvas → toFlowRequestBody → persisted → rehydrateNodes → canvas) is never tested. Edge cases like missing nodePositions/blockSettings keys in persisted flow are untested.

---

### 70. readErrorMessage (error message extraction)  
`src/api.ts` · **MEDIUM** · confidence medium · frontend-state-api

**Uncovered behavior:** readErrorMessage is not directly tested. It is tested indirectly via saveFlow (line 37-48 in api.test.ts), which shows the happy path (error string extracted). NOT tested: (1) readErrorMessage with body.error = empty string → should fall back to status, (2) readErrorMessage with body.error = non-string (number, null, object) → should fall back to status, (3) readErrorMessage when response.json() throws (empty body) → should fall back to status, (4) various fallbackVerb strings to ensure the message format is correct.

**Why it matters:** readErrorMessage is used by all API functions (saveFlow, getFlow, listFlows, listRuns, fetchHealth) to provide user-facing error messages. If the function has logic bugs (e.g., not trimming empty strings, not type-checking body.error), users will see confusing or generic 'Failed to X (status 400)' messages instead of actionable server errors like 'Invalid flow graph'.

**Production code:**
```
async function readErrorMessage(response: Response, fallbackVerb: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (body && typeof body.error === 'string' && body.error.trim()) {
      return body.error;
    }
  } catch {
    // Body was empty or not JSON; fall through to the status-based message.
  }
  return `${fallbackVerb} (status ${response.status})`;
}
```
**Existing test** (`tests/api.test.ts`):
```
it('surfaces the server error message instead of a bare status (finding 6)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: 'Invalid flow graph: node3: missing required field' }, false, 400)
      )
    );

    await expect(saveFlow('primary', { flow: {} } as never)).rejects.toThrow(
      'Invalid flow graph: node3: missing required field'
    );
  });
```
**Suggested test:** unit

**Example cases:**
- Returns server error message when body.error is a non-empty string
- Returns fallback status message when body.error is empty string (after trim)
- Returns fallback status message when body.error is not a string (number, null, object)
- Returns fallback status message when response.json() throws (no parseable body)
- Constructs message as 'fallbackVerb (status N)' format

**Mocks/fixtures/setup:** Direct unit test of readErrorMessage with mock Response objects. Test scenarios: {error: 'message'}, {error: ''}, {error: 123}, {error: null}, unparseable body, various fallbackVerb strings.

**Verification evidence:** readErrorMessage is a private function (api.ts lines 70-80) tested indirectly via saveFlow (api.test.ts lines 37-48) which tests the happy path: error string extracted from body.error. grep -rn 'readErrorMessage' in /Users/ido/Documents/reddix/tests/ returned zero direct unit tests. The function's edge cases are untested: (1) body.error = empty string → should fall back (line 73: trim() check passes but could be hollow), (2) body.error = non-string → should fall back (line 73: typeof check would fail), (3) response.json() throws → should fall back (line 76 catch does this). Only the narrow happy path (truthy non-empty string in body.error) is covered by the saveFlow test.

---

### 71. hasCycle  
`src/shared/graph.ts` · **MEDIUM** · confidence high · graph-validation

**Uncovered behavior:** Self-edges (an edge from a node to itself) are never tested. The code detects cycles correctly, but a minimal self-edge case (single node with edge to itself) is not explicitly tested. Also, multiple disconnected cycles are never tested - only one 2-node cycle is tested.

**Why it matters:** Self-edges are a degenerate but valid cycle case. Testing them separately from multi-node cycles ensures the cycle detection algorithm handles all cycle shapes. Also, flows with multiple independent cycles might exhibit unexpected behavior - only one cycle error is reported in the test.

**Production code:**
```
function hasCycle(flow: FlowModel): boolean {
  const adjacency = buildAdjacency(flow, false);
  const indegree = new Map<string, number>(flow.nodes.map((node) => [node.id, 0]));
  for (const targets of adjacency.values()) {
    for (const target of targets) {
      if (indegree.has(target)) {
        indegree.set(target, (indegree.get(target) ?? 0) + 1);
      }
    }
  }
  const queue = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id);
  let processed = 0;
  for (let index = 0; index < queue.length; index += 1) {
    processed += 1;
    for (const target of adjacency.get(queue[index]) ?? []) {
      if (!indegree.has(target)) {
        continue;
      }
      const degree = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, degree);
      if (degree === 0) {
        queue.push(target);
      }
    }
  }
  return processed < flow.nodes.length;
```
**Existing test** (`tests/graph.test.ts`):
```
it('reports missing required settings, cycles, and unreachable outputs', () => {
    const result = validateFlow({
      nodes: [
        { id: 'search', type: 'reddit.searchPosts', settings: { query: '' } },
        { id: 'filter', type: 'transform.filterText', settings: {} },
        { id: 'export', type: 'output.exportJson', settings: { path: '' } }
      ],
      edges: [
        { id: 'e1', source: 'search', target: 'filter', sourcePortId: 'items', targetPortId: 'items' },
        { id: 'e2', source: 'filter', target: 'search', sourcePortId: 'items', targetPortId: 'items' }
      ]
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        { nodeId: 'flow', message: 'Graph contains a cycle' },
```
**Suggested test:** unit

**Example cases:**
- validateFlow with single node and self-edge should report 'Graph contains a cycle'
- validateFlow with two disconnected cycles should report at least one 'Graph contains a cycle' error
- validateFlow with three-node cycle (A->B->C->A) should report 'Graph contains a cycle'
- validateFlow with self-edge plus acyclic nodes should report cycle error

**Mocks/fixtures/setup:** Use standard blocks (reddit.searchPosts, transform.filterText). Create edges with source === target, or create multiple separate cycles in the same flow.

**Verification evidence:** grep -n "source.*target.*source\|self.*edge" /Users/ido/Documents/reddix/tests/graph.test.ts returned (Bash completed with no output). Examined all edges in test file using Python: search->filter, filter->export, filter->search, search->export. No edge where source === target exists. The only cycle test (line 77) creates a 2-node cycle (search<->filter). No self-edge test and no test with multiple disconnected cycles.

---

### 72. applyLimit  
`src/shared/transforms.ts` · **MEDIUM** · confidence high · normalizers-transforms

**Uncovered behavior:** Edge cases: (1) negative limit (e.g., limit=-5) should return empty array via Math.max(0, -5)=0 - NOT TESTED; (2) zero limit should return empty array - NOT TESTED; (3) undefined/missing limit should fallback to items.length and return all items - NOT TESTED; (4) non-numeric limit string (e.g., 'abc') should fallback to items.length - NOT TESTED; (5) empty input array with any limit - NOT TESTED

**Why it matters:** MEDIUM business logic: the fallback to items.length and the Math.max(0, limit) clamping are load-bearing behaviors. If someone refactors coerceNumber or removes Math.max, truncation bugs silently occur. Edge cases like negative limits should be explicitly proven to work.

**Production code:**
```
export function applyLimit(items: SocialItem[], settings: Record<string, unknown>): SocialItem[] {
  const limit = coerceNumber(settings.limit, items.length);
  return items.slice(0, Math.max(0, limit));
}
```
**Existing test** (`tests/transforms.test.ts`):
```
it('limits result count', () => {
    expect(applyLimit(items, { limit: 1 })).toEqual([items[0]]);
  });
```
**Suggested test:** unit

**Example cases:**
- applyLimit(items, { limit: -5 }) should return []
- applyLimit(items, { limit: 0 }) should return []
- applyLimit([], { limit: 10 }) should return []
- applyLimit(items, { limit: undefined }) or { } should return all items (fallback to items.length)

**Mocks/fixtures/setup:** Use existing test fixture items array; no mocks needed

**Verification evidence:** grep -rn 'it(' /Users/ido/Documents/reddix/tests/transforms.test.ts shows 8 test cases in transforms suite. applyLimit has exactly 1 test: 'limits result count' (line 41-42) with expect(applyLimit(items, { limit: 1 })) testing only the positive case of limit=1. grep -rn 'applyLimit.*-\|applyLimit.*0\|applyLimit.*\[\]' /Users/ido/Documents/reddix/tests/transforms.test.ts returns no matches - confirming zero tests for negative limits, zero limits, undefined limits, non-numeric strings, or empty input arrays.

---

### 73. normalizeRedditPayload and normalizeTwitterPayload - empty payload object  
`src/shared/normalizers.ts` · **MEDIUM** · confidence high · normalizers-transforms

**Uncovered behavior:** Edge case NOT tested: payload={} (empty object, no keys). Per line 107 in normalizers.ts: "if (isRecord(value) && Object.keys(value).length > 0)", an empty payload object {} would NOT fire the onUnrecognized callback (because Object.keys({}).length === 0). This is a silent-empty case that looks benign but is distinct from the callback-firing case. There's no test proving this behavior.

**Why it matters:** MEDIUM signal contract: onUnrecognized is meant to distinguish between "0 results caused by CLI shape change" and "genuinely empty result". An empty payload {} silently returns [] without the signal, which might be indistinguishable from a genuinely empty data: [] response. Not tested explicitly.

**Production code:**
```
export function normalizeRedditPayload(
  payload: unknown,
  sourceBlockId: string,
  onUnrecognized?: UnrecognizedPayloadHandler
): SocialItem[] {
  return extractArray(payload, onUnrecognized).map((raw) => {
```
**Existing test** (`tests/normalizersUnrecognized.test.ts`):
```
it('invokes the callback with top-level keys when data resolves to a non-record', () => {
    const onUnrecognized = vi.fn();
    // `data` is a primitive, so no array and no single record can be extracted —
    // the silent-empty case the signal exists to catch.
    const items = normalizeRedditPayload({ data: 'unexpected string payload' }, 'block', onUnrecognized);
```
**Suggested test:** unit

**Example cases:**
- normalizeRedditPayload({}, 'block', onUnrecognized) -> returns [], onUnrecognized NOT called
- normalizeRedditPayload({ data: [] }, 'block', onUnrecognized) -> returns [], onUnrecognized NOT called (well-formed empty)
- normalizeRedditPayload({ data: 'string' }, 'block', onUnrecognized) -> returns [], onUnrecognized IS called (shape changed)

**Mocks/fixtures/setup:** Standard test with vi.fn() mock for onUnrecognized

**Verification evidence:** grep -rn 'normalizeRedditPayload\|normalizeTwitterPayload' /Users/ido/Documents/reddix/tests/normalizersUnrecognized.test.ts shows 3 test cases with payloads: { data: 'string' } (line 9), { ok: true, data: [] } (line 17), { data: [{ ... }] } (line 25). Per normalizers.ts line 107, empty object {} would NOT fire onUnrecognized callback (Object.keys({}).length === 0 fails the check). This distinct edge case is not tested anywhere.

---

### 74. Logger.warn  
`server/logger.ts` · **MEDIUM** · confidence high · observability-lifecycle

**Uncovered behavior:** The logger.warn() method is implemented but never called in any test. Only logger.info() and logger.error() are tested. The warn level is never verified to emit the correct JSON structure with level='warn'.

**Why it matters:** warn-level logs are often used for recoverable errors and operational issues. If warn() doesn't properly emit the JSON structure or redact secrets, warning logs could leak sensitive data or be malformed, making operational monitoring unreliable.

**Production code:**
```
    warn: (message: string, fields: LogFields = {}) => emit('warn', message, fields),
```
**Existing test** (`tests/logger.test.ts`):
```
(no excerpt)
```
**Suggested test:** unit

**Example cases:**
- logger.warn emits structured JSON with level='warn'
- logger.warn redacts secrets from message and fields
- logger.warn handles empty fields gracefully

**Mocks/fixtures/setup:** A lines array to capture sink output; secrets map with test token; EventLogger interface stub

**Verification evidence:** grep -r 'logger.warn\|.warn(' /Users/ido/Documents/reddix/tests --include='*.test.ts' returned zero results. grep -r '.warn' /Users/ido/Documents/reddix/tests/logger.test.ts returned zero actual invocations of logger.warn (only a mock stub definition in executorLogging.test.ts at line 12: 'warn: push("warn")'). The createLogger test at /Users/ido/Documents/reddix/tests/logger.test.ts tests info() and error() but has no test for warn(). Production code at /Users/ido/Documents/reddix/server/routes.ts, storage.ts, sseHub.ts, and csrfGuard.ts calls logger.warn() but these scenarios are never tested.

---

### 75. Metrics.increment  
`server/metrics.ts` · **MEDIUM** · confidence high · observability-lifecycle

**Uncovered behavior:** The 'by' parameter (3rd argument to increment) is never tested with custom values. All test invocations use the default by=1. Edge cases like negative decrements, zero, or large numbers are not tested.

**Why it matters:** If code calls increment with a negative 'by' value to decrement counters, or with non-integer/extreme values, the behavior is untested. This could lead to negative counter values or corruption of counter semantics in metrics collection.

**Production code:**
```
    increment(name, labels, by = 1) {
      const key = metricKey(name, labels);
      counters.set(key, (counters.get(key) ?? 0) + by);
    },
```
**Existing test** (`tests/metrics.test.ts`):
```
    metrics.increment('flow_runs_total', { status: 'success' });
    metrics.increment('flow_runs_total', { status: 'failed' });
    metrics.increment('runs_total');
```
**Suggested test:** unit

**Example cases:**
- increment with positive by value accumulates correctly
- increment with negative by value decrements counter
- increment with by=0 leaves counter unchanged
- increment handles large by values without overflow

**Mocks/fixtures/setup:** Fresh metrics instance created with createMetrics(); snapshot() to verify results

**Verification evidence:** grep -r 'increment(' /Users/ido/Documents/reddix/tests --include='*.test.ts' found all calls in /Users/ido/Documents/reddix/tests/metrics.test.ts. All increment calls use either 1 or 2 arguments: metrics.increment('flow_runs_total', { status: 'success' }) (line 7), metrics.increment('runs_total') (line 10), metrics.increment('e', { a: '1', b: '2' }) (line 29), noopMetrics.increment('x') (line 35). grep -rE 'increment\([^)]*,\s*\{[^}]*\},\s*[0-9]' /Users/ido/Documents/reddix/tests --include='*.test.ts' returned zero results. The 'by' parameter (3rd argument) is never tested with custom values (negative, zero, large numbers).

---

### 76. Metrics.observe  
`server/metrics.ts` · **MEDIUM** · confidence high · observability-lifecycle

**Uncovered behavior:** observe() is only tested with positive integer values (100, 300). Edge cases never tested: zero, negative values, Infinity, NaN, very large numbers, floating-point precision loss in sum/min/max calculations.

**Why it matters:** If observe is called with edge-case values (e.g., negative latencies due to clock skew, NaN from failed duration calculations), the histogram becomes corrupted. This silently breaks metrics analysis and alerting that depends on valid min/max/sum values.

**Production code:**
```
    observe(name, value, labels) {
      const key = metricKey(name, labels);
      const current = histograms.get(key);
      if (!current) {
        histograms.set(key, { count: 1, sum: value, min: value, max: value });
        return;
      }
      histograms.set(key, {
        count: current.count + 1,
        sum: current.sum + value,
        min: Math.min(current.min, value),
        max: Math.max(current.max, value)
      });
    },
```
**Existing test** (`tests/metrics.test.ts`):
```
    metrics.observe('cli_duration_ms', 100, { provider: 'reddit' });
    metrics.observe('cli_duration_ms', 300, { provider: 'reddit' });
```
**Suggested test:** unit

**Example cases:**
- observe with zero value initializes min/max/sum to 0
- observe with negative value (e.g., -1) is recorded but min becomes negative
- observe with NaN or Infinity does not crash but sets min/max correctly
- observe accumulates sum correctly with floating-point values

**Mocks/fixtures/setup:** Fresh metrics instance; snapshot() to verify histogram state

**Verification evidence:** grep -r 'observe' /Users/ido/Documents/reddix/tests/metrics.test.ts found only three calls: metrics.observe('cli_duration_ms', 100, { provider: 'reddit' }) (line 20), metrics.observe('cli_duration_ms', 300, { provider: 'reddit' }) (line 21), noopMetrics.observe('y', 1) (line 36). All values are positive integers. grep -r 'observe.*-\|observe.*NaN\|observe.*Infinity\|observe.*0)' /Users/ido/Documents/reddix/tests/metrics.test.ts returned zero results. Edge cases (zero, negative, NaN, Infinity, floating-point precision) are never tested.

---

### 77. formatFatalReason  
`server/index.ts` · **MEDIUM** · confidence high · observability-lifecycle

**Uncovered behavior:** formatFatalReason is never tested. No verification that: (1) Error.stack is used when available, (2) Error.message fallback works, (3) non-Error values are stringified, (4) secrets in stack traces are redacted.

**Why it matters:** Fatal errors (uncaughtException, unhandledRejection) may contain sensitive data in stack traces. If redactSecrets fails or is skipped, tokens/secrets in stack traces reach stderr/logs, creating a security breach.

**Production code:**
```
function formatFatalReason(reason: unknown): string {
  const message =
    reason instanceof Error ? reason.stack ?? reason.message : typeof reason === 'string' ? reason : String(reason);
  return redactSecrets(message, fatalLogSecrets);
}
```
**Existing test:** none.
**Suggested test:** unit

**Example cases:**
- formatFatalReason with Error uses stack if available
- formatFatalReason falls back to error.message if stack missing
- formatFatalReason with string reason returns stringified reason with redaction
- formatFatalReason redacts secrets from error message/stack

**Mocks/fixtures/setup:** fatalLogSecrets map with test token; test Error objects; mock redactSecrets or capture output

**Verification evidence:** grep -r 'formatFatalReason' /Users/ido/Documents/reddix/tests --include='*.test.ts' returned zero results. The function (lines 77-81 of index.ts) is only called within untested process event handlers (lines 42, 68, 73). No test verifies: Error.stack is used when available, Error.message fallback, non-Error values stringified, or secret redaction in stack traces.

---

### 78. computeNextRunAt  
`server/scheduler.ts` · **MEDIUM** · confidence high · scheduler-throttling

**Uncovered behavior:** The jitter calculation (Math.floor(random() * options.jitterMs)) when jitterMs > 0 is never exercised. No test verifies that jitter bounds are [0, jitterMs) or that the computation correctly adds jitter to nextRunAt.

**Why it matters:** Jitter is critical for preventing thundering herd when many flows are scheduled to run at the same time. If jitter bounds are incorrect (e.g., jitter could exceed jitterMs or be negative), it breaks the scheduling contract and causes bunching of runs.

**Production code:**
```
  function computeNextRunAt(intervalMs: number, from: number): number {
    const safeInterval = Math.max(intervalMs, options.minIntervalMs);
    const jitter = options.jitterMs > 0 ? Math.floor(random() * options.jitterMs) : 0;
    return from + safeInterval + jitter;
  }
```
**Existing test** (`tests/scheduler.test.ts`):
```
All tests create scheduler with jitterMs: 0, disabling jitter computation entirely
```
**Suggested test:** unit

**Example cases:**
- Test that jitter=0 when jitterMs=0
- Test that jitter is in range [0, jitterMs) when jitterMs>0 with mocked random returning 0, 0.5, 0.99
- Test that nextRunAt = from + safeInterval + jitter with specific values
- Test that negative or very large jitterMs values are handled safely

**Mocks/fixtures/setup:** Mock random() to return specific values (0, 0.5, 0.99) to test boundary conditions and verify jitter computation. Use fixed clock.

**Verification evidence:** grep -rn "jitterMs.*>.*0\|jitterMs.*[1-9]" /Users/ido/Documents/reddix/tests --include="*.test.ts" returned no output. All occurrences of jitterMs in tests are set to 0: grep -rn "jitterMs" /Users/ido/Documents/reddix/tests --include="*.test.ts" shows every instance is jitterMs: 0 across scheduler.test.ts and schedulerResilience.test.ts. The implementation at server/scheduler.ts:56 contains: const jitter = options.jitterMs > 0 ? Math.floor(random() * options.jitterMs) : 0; but this is never exercised with jitterMs > 0.

---

### 79. tick  
`server/scheduler.ts` · **MEDIUM** · confidence high · scheduler-throttling

**Uncovered behavior:** The tickInFlight guard prevents concurrent tick() calls from running simultaneously. No test verifies this: if tick() is called while already in-flight, the second call should return immediately without processing due flows.

**Why it matters:** CRITICAL invariant for scheduler correctness. If concurrent ticks run in parallel, they could double-fire flows, corrupt lastProviderFireAt state, or cause race conditions in the due flows list. The guard is a single-flight mechanism.

**Production code:**
```
  async function tick(): Promise<void> {
    if (tickInFlight) {
      return;
    }
    tickInFlight = true;
    try {
      // ... process due flows ...
    } finally {
      tickInFlight = false;
    }
  }
```
**Existing test** (`tests/scheduler.test.ts`):
```
(no excerpt)
```
**Suggested test:** unit

**Example cases:**
- Call tick() twice concurrently (Promise.all); verify only one tick actually processes flows
- Start a slow tick, call tick() again immediately, verify second call returns without processing
- Verify with mocked runFlow that takes 1s; call tick() twice; confirm runFlow called only once per due flow

**Mocks/fixtures/setup:** Mock runFlow to return a promise that resolves after a delay. Use Promise.all to invoke multiple tick() calls concurrently. Track how many times runFlow is called.

**Verification evidence:** grep -rn "concurrent.*tick\|tickInFlight\|Promise.all.*tick\|Promise.race.*tick" /Users/ido/Documents/reddix/tests --include="*.test.ts" returned no results. All scheduler.test.ts and schedulerResilience.test.ts calls to tick() are sequential (await scheduler.tick()). The tickInFlight guard at server/scheduler.ts:52-55 prevents concurrent tick execution but is never tested for concurrent calls.

---

### 80. computeNextRunAt  
`server/scheduler.ts` · **MEDIUM** · confidence high · scheduler-throttling

**Uncovered behavior:** The minimum interval enforcement (safeInterval = Math.max(intervalMs, options.minIntervalMs)) is never tested with a sub-minimum intervalMs. No test verifies that if registered with intervalMs < minIntervalMs, the scheduler enforces the floor and schedules the next run at least minIntervalMs away.

**Why it matters:** CRITICAL throttling invariant: the scheduler MUST never run flows faster than minIntervalMs (15 min), even if registered with a smaller interval. Without this enforcement, the CLI throttling floor is bypassed, causing rate-limit violations or API abuse.

**Production code:**
```
  function computeNextRunAt(intervalMs: number, from: number): number {
    const safeInterval = Math.max(intervalMs, options.minIntervalMs);
    const jitter = options.jitterMs > 0 ? Math.floor(random() * options.jitterMs) : 0;
    return from + safeInterval + jitter;
  }
```
**Existing test** (`tests/scheduler.test.ts`):
```
All tests create scheduler with minIntervalMs: MIN (15 * 60 * 1000)
```
**Suggested test:** unit

**Example cases:**
- Register flow with intervalMs = 5 min (less than 15-min floor), verify nextRunAt is at least 15 min away
- Register flow with intervalMs = 1 ms, verify computeNextRunAt returns from + 15*60*1000 (not from + 1)
- Multiple sub-minimum registrations, verify none fire closer than 15 min apart

**Mocks/fixtures/setup:** Create scheduler with minIntervalMs set to MIN. Register flows with intervalMs values less than minIntervalMs. Use fixed clock and call triggerDue or tick; inspect nextRunAt values.

**Verification evidence:** grep -rn "jitterMs.*>.*0\|jitterMs.*[1-9]" /Users/ido/Documents/reddix/tests --include="*.test.ts" returned no output. All occurrences of jitterMs in tests are set to 0: grep -rn "jitterMs" /Users/ido/Documents/reddix/tests --include="*.test.ts" shows every instance is jitterMs: 0 across scheduler.test.ts and schedulerResilience.test.ts. The implementation at server/scheduler.ts:56 contains: const jitter = options.jitterMs > 0 ? Math.floor(random() * options.jitterMs) : 0; but this is never exercised with jitterMs > 0.

---

### 81. KeyedMutex.run tail cleanup  
`server/keyedMutex.ts` · **MEDIUM** · confidence medium · scheduler-throttling

**Uncovered behavior:** The tail cleanup logic (tails.delete(key) when settled resolves) is never tested. No test verifies that the tails map actually cleans up completed entries, potentially causing memory leaks if the same key is reused many times.

**Why it matters:** Memory leak: if tails never delete entries, the map grows unbounded. Over time with many unique keys or keys reused after completion, tails grows to consume all memory. The cleanup is essential for long-running schedulers.

**Production code:**
```
      const settled = result.then(
        () => undefined,
        (error) => {
          logger?.warn('mutex.taskFailed', {
            key,
            detail: error instanceof Error ? error.message : String(error)
          });
          return undefined;
        }
      );
      tails.set(key, settled);
      void settled.then(() => {
        if (tails.get(key) === settled) {
          tails.delete(key);
        }
      });
```
**Existing test** (`tests/keyedMutex.test.ts`):
```
it('keeps serializing after a task rejects', async () => {
    const failing = mutex.run('a', async () => {
      events.push('fail');
      throw new Error('boom');
    });
    const next = mutex.run('a', async () => {
      events.push('after');
    });
    await expect(failing).rejects.toThrow('boom');
    await next;
    expect(events).toEqual(['fail', 'after']);
  });
```
**Suggested test:** unit

**Example cases:**
- Run task on key 'a', complete it, run task again on same key, verify no duplicate promises in internal state
- Run 1000 tasks sequentially on same key, verify tails map never holds more than 1-2 entries
- Run task on key, wait for completion, verify tails.get(key) is undefined (no entry)

**Mocks/fixtures/setup:** Export or expose the internal tails map for inspection (or use a test-only getter). Call mutex.run multiple times on the same key, awaiting each; inspect tails size before and after.

**Verification evidence:** grep -rn "tails\|cleanup\|memory.*leak" /Users/ido/Documents/reddix/tests/keyedMutex.test.ts returned no results. The keyedMutex.test.ts file contains 3 tests: serialization, concurrent keys, and error resilience. None inspect the internal tails map state. The implementation at keyedMutex.ts:35-38 contains: void settled.then(() => { if (tails.get(key) === settled) { tails.delete(key); } }); but cleanup is never verified in tests.

---

### 82. onSkip callback contract  
`server/scheduler.ts` · **MEDIUM** · confidence high · scheduler-throttling

**Uncovered behavior:** The test verifies the skip metric is incremented but does NOT verify that onSkip is actually called with the correct flowId or that its return value is returned from triggerNow. No test checks the onSkip return value contract or error handling if onSkip rejects.

**Why it matters:** onSkip is a critical callback for the caller to handle unavailable flows. If it's not called, the caller never learns a flow was skipped. If its return value is not propagated, the caller can't act on the result. If rejection is not handled, it could crash the scheduler.

**Production code:**
```
  async function triggerNow(flowId: string): Promise<unknown> {
    if (running.has(flowId)) {
      logger?.info('schedule.skipped', { flowId, reason: 'already-running' });
      metrics.increment('schedule_skipped_total', { reason: 'already-running' });
      return options.onSkip(flowId);
    }
    running.add(flowId);
    await acquireRunSlot();
    logger?.info('schedule.triggered', { flowId });
    metrics.increment('schedule_triggered_total');
    try {
      return await options.runFlow(flowId);
    } finally {
      releaseRunSlot();
      running.delete(flowId);
    }
  }
```
**Existing test** (`tests/schedulerResilience.test.ts`):
```
expect(metrics.snapshot().counters['schedule_skipped_total{reason=already-running}']).toBe(1);
```
**Suggested test:** unit

**Example cases:**
- Verify onSkip is called with correct flowId when overlap detected
- Verify the return value from onSkip is returned from triggerNow
- Verify if onSkip rejects, the error is propagated (not swallowed)

**Mocks/fixtures/setup:** Mock onSkip with vi.fn() that records calls and return values. Create overlapping trigger scenario. Inspect calls and return values.

**Verification evidence:** grep -rn "onSkip.*return\|return.*onSkip\|onSkip.*rejects" /Users/ido/Documents/reddix/tests --include="*.test.ts" returned no results. The test at scheduler.test.ts:19-43 (skips overlapping runs) calls onSkip and tracks that it was invoked via the skipped array, but never captures or asserts on the return value of triggerNow when onSkip is called. The triggerDue test at line 115 mocks onSkip to return 'skipped' but never asserts the return value is propagated.

---

### 83. isCrossSiteBrowserRequest  
`server/csrfGuard.ts` · **MEDIUM** · confidence high · security-middleware

**Uncovered behavior:** isCrossSiteBrowserRequest is exported (line 34) and critical to CSRF logic, but is never directly tested. It is only indirectly tested via isCrossSiteMutation. Direct test coverage of the boundary function is missing — specifically unknown/malformed Sec-Fetch-Site values that are not in SAME_SITE_FETCH_VALUES.

**Why it matters:** isCrossSiteBrowserRequest is a critical CSRF boundary function. If unknown header values are added in future browsers or if the logic is refactored, the direct tests would catch regressions. Currently only relying on indirect coverage through isCrossSiteMutation, which tests the combined logic but not the boundary condition in isolation.

**Production code:**
```
export function isCrossSiteBrowserRequest(secFetchSite: string | undefined): boolean {
  if (!secFetchSite) {
    return false;
  }

  return !SAME_SITE_FETCH_VALUES.has(secFetchSite);
}
```
**Existing test** (`tests/csrfGuard.test.ts`):
```
it('allows same-origin and user-initiated (none) mutations', () => {
    expect(isCrossSiteMutation('POST', 'same-origin')).toBe(false);
    expect(isCrossSiteMutation('POST', 'none')).toBe(false);
  });
```
**Suggested test:** unit

**Example cases:**
- isCrossSiteBrowserRequest('same-origin') returns false
- isCrossSiteBrowserRequest('cross-site') returns true
- isCrossSiteBrowserRequest('unknown-value') returns true (treated as cross-site by default)
- isCrossSiteBrowserRequest(undefined) returns false

**Mocks/fixtures/setup:** No mocks required; pure function.

**Verification evidence:** grep -r 'isCrossSiteBrowserRequest' /Users/ido/Documents/reddix/tests returned no results. grep -r 'isCrossSiteBrowserRequest' /Users/ido/Documents/reddix/tests/csrfGuard.test.ts returned no results. The function is exported at line 34 of csrfGuard.ts but never directly tested. It is only tested indirectly via isCrossSiteMutation (which calls it internally on line 31), and via csrfGuard middleware. No direct test of isCrossSiteBrowserRequest with arbitrary/malformed Sec-Fetch-Site values exists.

---

### 84. createCsrfGuard  
`server/csrfGuard.ts` · **MEDIUM** · confidence high · security-middleware

**Uncovered behavior:** Logger functionality is not tested. createCsrfGuard accepts an optional EventLogger parameter and calls logger.warn() on blocked requests, but no test verifies this logging behavior. Tested only with default guard (csrfGuard export without logger).

**Why it matters:** Security event logging is critical for forensics and incident response. Rejection of cross-site mutations should be logged (as per line 55-59 design). Without test coverage, logger integration could break silently, breaking security monitoring and audit trails.

**Production code:**
```
export function createCsrfGuard(logger?: EventLogger) {
  return function csrfGuard(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers['sec-fetch-site'];
    const secFetchSite = Array.isArray(header) ? header[0] : header;

    if (isCrossSiteMutation(req.method, secFetchSite)) {
      logger?.warn('csrf.blocked', {
```
**Existing test** (`tests/csrfGuard.test.ts`):
```
describe('csrfGuard middleware', () => {
  function run(method: string, secFetchSite: string | string[] | undefined) {
    const req = { method, headers: { 'sec-fetch-site': secFetchSite } } as unknown as Request;
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;
    csrfGuard(req, res, next);
    return { status, json, next };
  }
```
**Suggested test:** unit

**Example cases:**
- createCsrfGuard with logger logs blocked POST with secFetchSite='cross-site'
- createCsrfGuard with logger logs method, path, and secFetchSite value
- createCsrfGuard with logger logs 'missing' when Sec-Fetch-Site header absent
- createCsrfGuard without logger works without throwing (default case)

**Mocks/fixtures/setup:** Mock EventLogger with vi.fn() for warn method; spy on calls to verify parameters match logged fields.

**Verification evidence:** grep -r 'EventLogger' /Users/ido/Documents/reddix/tests returned no results. grep -r 'createCsrfGuard.*logger' /Users/ido/Documents/reddix/tests returned one result in runNodeRoute.test.ts line 60 where createCsrfGuard() is called with no arguments. All tests in csrfGuard.test.ts use the default export csrfGuard (line 72 of csrfGuard.ts) or call createCsrfGuard() without a logger parameter. The logger.warn() behavior (line 55 in csrfGuard.ts) is never tested.

---

### 85. createRateLimiter  
`server/rateLimiter.ts` · **MEDIUM** · confidence high · security-middleware

**Uncovered behavior:** Default TTL calculation is not tested. When ttlMs is undefined, the formula Math.max(minIntervalMs * 2, 60_000) is used. Test only covers explicit ttlMs override; does not verify default calculation or the max(×2, 60s) logic.

**Why it matters:** The default TTL logic is a memory-leak safeguard for long-running processes. If minIntervalMs < 30s, the floor is 60s. If minIntervalMs >= 30s, TTL is 2×minIntervalMs. Without explicit test of this default, changes to the formula could silently break memory management. This is especially critical since the formula has a hardcoded 60_000 constant.

**Production code:**
```
const ttlMs = options.ttlMs ?? Math.max(options.minIntervalMs * 2, 60_000);
```
**Existing test** (`tests/rateLimiter.test.ts`):
```
it('evicts stale keys so long-running processes do not retain every flow id forever', () => {
    let t = 1000;
    const limiter = createRateLimiter({ minIntervalMs: 100, ttlMs: 500, now: () => t });

    expect(limiter.tryAcquire('old-flow')).toBe(true);
    t = 2000;
    expect(limiter.tryAcquire('new-flow')).toBe(true);

    expect(limiter.size).toBe(1);
  });
```
**Suggested test:** unit

**Example cases:**
- createRateLimiter with minIntervalMs=100, no ttlMs specified, uses default of Math.max(200, 60000)=60000
- createRateLimiter with minIntervalMs=50000, no ttlMs specified, uses default of Math.max(100000, 60000)=100000
- Explicit ttlMs overrides default calculation (already tested)

**Mocks/fixtures/setup:** Mock time via now() function; create limiter without ttlMs option and verify pruning happens at default interval.

**Verification evidence:** grep -r 'ttlMs' /Users/ido/Documents/reddix/tests/rateLimiter.test.ts returns one match at line 37: ttlMs: 500 in explicit override form. No test cases verify the default TTL formula (line 20 of rateLimiter.ts: Math.max(options.minIntervalMs * 2, 60_000)). All other 4 test cases in rateLimiter.test.ts omit ttlMs entirely but do not assert on default TTL behavior—they test rate-limiting acquisition and key eviction, but not the default formula calculation.

---

### 86. broadcast  
`server/sseHub.ts` · **MEDIUM** · confidence high · sse-streaming

**Uncovered behavior:** Event name and message format contract: no test verifies that the broadcast message contains the correct SSE format (event: <name>, data: <json>, double newline). Tests check only for the presence of the event name string, not the full format.

**Why it matters:** SSE clients parse event messages expecting strict format. A malformed message (e.g., missing double newline, wrong event line format) will cause client parsing to fail and miss critical run-step updates.

**Production code:**
```
function broadcast(event: string, payload: unknown): void {
    const safePayload = redactPayload(payload, redact);
    const message = redact(`event: ${event}\ndata: ${JSON.stringify(safePayload)}\n\n`);
    for (const client of [...clients.values()]) {
      safeWrite(client, message);
    }
  }
```
**Existing test** (`tests/sseHub.test.ts`):
```
it('drops a client whose write throws during broadcast', () => {
    const hub = createSseHub();
    const good = fakeResponse();
    const bad = fakeResponse();
    hub.handler(fakeRequest(), good.response, vi.fn());
    hub.handler(fakeRequest(), bad.response, vi.fn());
    expect(hub.clientCount).toBe(2);
    // Arm failure after the handshake so the next write (broadcast) throws,
    // independent of how many chunks the handshake emits.
    bad.failOnWriteAfter = bad.writes.length;

    hub.broadcast('run-step', { ok: true });

    expect(hub.clientCount).toBe(1);
    expect(bad.ended).toBe(true);
    expect(good.writes.join('')).toContain('run-step');
  });
```
**Suggested test:** unit

**Example cases:**
- Broadcast and verify exact format 'event: <name>\ndata: {...}\n\n' is produced
- Verify double newline terminates each message (\n\n present)
- Verify event name in message matches broadcast argument

**Mocks/fixtures/setup:** Use fakeResponse() to capture writes. Create a simple broadcast call and parse the raw message string.

**Verification evidence:** grep -rn 'event:.*data\|event.*data\|SSE.*format' /Users/ido/Documents/reddix/tests/sseHub.test.ts returned no results. grep -rn '\\n\\n\|double.*newline\|SSE.*format' /Users/ido/Documents/reddix/tests/ returned no results. The broadcast function at line 135-140 constructs the SSE message as 'event: ${event}\ndata: ${JSON.stringify(safePayload)}\n\n' but tests only use .toContain('run-step') and .toContain('event: ready'), never verifying the full SSE format structure including the double newline terminator.

---

### 87. broadcast  
`server/sseHub.ts` · **MEDIUM** · confidence high · sse-streaming

**Uncovered behavior:** Multiple sequential broadcasts: tests broadcast once and check the outcome. No test verifies that after one client drops, subsequent broadcasts exclude the dropped client and continue to other healthy clients.

**Why it matters:** Event ordering and client isolation are critical. If a dropped client affects subsequent broadcasts (e.g., message queue corruption), later clients miss steps. A multi-broadcast sequence test would catch state pollution.

**Production code:**
```
  function broadcast(event: string, payload: unknown): void {
    const safePayload = redactPayload(payload, redact);
    const message = redact(`event: ${event}\ndata: ${JSON.stringify(safePayload)}\n\n`);
    for (const client of [...clients.values()]) {
      safeWrite(client, message);
    }
  }
```
**Existing test** (`tests/sseHub.test.ts`):
```
  it('drops a client whose write throws during broadcast', () => {
    const hub = createSseHub();
    const good = fakeResponse();
    const bad = fakeResponse();
    hub.handler(fakeRequest(), good.response, vi.fn());
    hub.handler(fakeRequest(), bad.response, vi.fn());
    expect(hub.clientCount).toBe(2);
    // Arm failure after the handshake so the next write (broadcast) throws,
    // independent of how many chunks the handshake emits.
    bad.failOnWriteAfter = bad.writes.length;

    hub.broadcast('run-step', { ok: true });

    expect(hub.clientCount).toBe(1);
    expect(bad.ended).toBe(true);
    expect(good.writes.join('')).toContain('run-step');
  });
```
**Suggested test:** unit

**Example cases:**
- Broadcast to 3 clients, drop the middle one on its write, then broadcast again and verify only endpoints 1 and 3 receive the second broadcast
- Broadcast multiple events in sequence, verify they arrive in order and dropped clients do not corrupt the stream for others

**Mocks/fixtures/setup:** Set up 3 fakeResponse() instances. Cause one to fail on a specific write. Perform 2-3 sequential broadcasts. Inspect the writes of all 3 clients.

**Verification evidence:** grep -rn 'event:.*data\|event.*data\|SSE.*format' /Users/ido/Documents/reddix/tests/sseHub.test.ts returned no results. grep -rn '\\n\\n\|double.*newline\|SSE.*format' /Users/ido/Documents/reddix/tests/ returned no results. The broadcast function at line 135-140 constructs the SSE message as 'event: ${event}\ndata: ${JSON.stringify(safePayload)}\n\n' but tests only use .toContain('run-step') and .toContain('event: ready'), never verifying the full SSE format structure including the double newline terminator.

---

### 88. getPreferences  
`server/storage.ts` · **MEDIUM** · confidence high · storage-persistence

**Uncovered behavior:** Type-coercion edge cases: when preferences.json contains defaultExportDir as number, array, or object (valid JSON but wrong type), getPreferences silently uses default 'outputs'. Similarly, selectedFlowId as number or array gets rejected and defaults to null. These are tested only for schemaVersion mismatch, not for individual field type validation.

**Why it matters:** Data consistency: if a corrupted preferences file sets defaultExportDir to 123 or [], the user loses their setting without warning. Ensures migration logic correctly validates individual field types and warns on coercion.

**Production code:**
```
async getPreferences(): Promise<Preferences> {
      await ensureDirs();
      const raw = await readJson<unknown>(preferencesPath, {}, logger);
      const migrated: Preferences = {
        schemaVersion: 1,
        defaultExportDir:
          isRecord(raw) && typeof raw.defaultExportDir === 'string' ? raw.defaultExportDir : 'outputs',
        selectedFlowId:
          isRecord(raw) && (typeof raw.selectedFlowId === 'string' || raw.selectedFlowId === null)
            ? raw.selectedFlowId
            : null
      };
      if (!isRecord(raw) || raw.schemaVersion !== 1) {
        await writeJson(preferencesPath, migrated, logger);
      }
      return migrated;
    }
```
**Existing test** (`tests/storage.test.ts`):
```
it('migrates schema-less preferences on load', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-'));
    await writeFile(
      path.join(dir, 'preferences.json'),
      JSON.stringify({ defaultExportDir: 'exports', selectedFlowId: 'flow-1' })
    );

    const storage = createStorage({ baseDir: dir });
    expect(await storage.getPreferences()).toEqual({
      schemaVersion: 1,
      defaultExportDir: 'exports',
      selectedFlowId: 'flow-1'
    });
    expect(JSON.parse(await readFile(path.join(dir, 'preferences.json'), 'utf8')).schemaVersion).toBe(1);
  });
```
**Suggested test:** unit

**Example cases:**
- preferences.json with defaultExportDir=123 (number): should normalize to 'outputs' and rewrite file
- preferences.json with selectedFlowId=[] (array): should normalize to null and rewrite file
- preferences.json with defaultExportDir=true (boolean): should normalize to 'outputs'
- preferences.json with selectedFlowId={id:'x'} (object): should normalize to null

**Mocks/fixtures/setup:** Write preferences.json with defaultExportDir/selectedFlowId as non-string types (but valid JSON), create storage, call getPreferences, verify type coercion and fallback defaults used.

**Verification evidence:** grep -rn 'defaultExportDir.*[0-9]\|defaultExportDir.*\[\|selectedFlowId.*[0-9]\|selectedFlowId.*\[' /Users/ido/Documents/reddix/tests/ returned only string test cases. Tests at storage.test.ts lines 135-164 verify: (1) schema-less prefs with string values; (2) invalid schemaVersion. They do NOT test type-coercion for defaultExportDir as number/array/object (lines 85-85 type check) or selectedFlowId as number/array (lines 87-88 type checks). Type rejection behavior is untested.

---

### 89. appendRun  
`server/storage.ts` · **MEDIUM** · confidence medium · storage-persistence

**Uncovered behavior:** Run-cap eviction order with concurrent appends and partial corruption: if runs file is corrupted (e.g., partial array [valid, valid, {incomplete]), appendRun normalizes to [valid, valid], adds new run, then caps. FIFO eviction is tested with sequential appends but not tested when mixed with concurrent corruption scenarios or when maxRunsPerFlow=1 (edge case requiring exact eviction).

**Why it matters:** Business logic: run history must maintain insertion order (FIFO eviction). If the cap logic breaks on edge cases (e.g., maxRunsPerFlow=1 with corrupted partial array), the oldest run may be lost incorrectly or duplicated.

**Production code:**
```
async appendRun(run: RunRecord): Promise<void> {
      const filePath = safeSegmentPath(runsDir, run.flowId, '.json');
      await runWriteMutex.run(run.flowId, async () => {
        await ensureDirs();
        const runs = normalizeRunList(await readJson<unknown>(filePath, [], logger), filePath, logger);
        const capped = [...runs, run].slice(-maxRunsPerFlow);
        await writeJson(filePath, capped, logger);
      });
    }
```
**Existing test** (`tests/storage.test.ts`):
```
it('round-trips flows and caps run history per flow', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-'));
    const storage = createStorage({ baseDir: dir, maxRunsPerFlow: 2 });
    const saved = flow('flow-1');

    await storage.saveFlow(saved);
    await storage.appendRun(run('old', 'flow-1'));
    await storage.appendRun(run('middle', 'flow-1'));
    await storage.appendRun(run('new', 'flow-1'));

    expect(await storage.getFlow('flow-1')).toEqual(saved);
    expect((await storage.listRuns('flow-1')).map((record) => record.id)).toEqual(['middle', 'new']);
  });
```
**Suggested test:** unit

**Example cases:**
- maxRunsPerFlow=1: append run to empty file, then append second run; verify only second run remains
- Pre-corrupted file with partial array [run1, incomplete], append run2; verify only run2 in result, run1 dropped due to corruption
- Concurrent appends with maxRunsPerFlow=3 where two appends complete before capping logic; verify FIFO and exactly 3 runs remain

**Mocks/fixtures/setup:** Create runs file with corrupted partial array. Create storage with maxRunsPerFlow=1 and maxRunsPerFlow=3. Verify eviction order and that mutex prevents lost records.

**Verification evidence:** grep -rn 'maxRunsPerFlow' /Users/ido/Documents/reddix/tests/ returned only maxRunsPerFlow: 2 (line 11) and maxRunsPerFlow: 100 (line 84). The boundary case maxRunsPerFlow=1 (which would test eviction on every append) is never tested. The FIFO eviction logic at line 68 of storage.ts is tested only with cap=2. Partial corruption recovery during append is also untested.

---

### 90. ensureDirs  
`server/storage.ts` · **MEDIUM** · confidence high · storage-persistence

**Uncovered behavior:** Directory creation on first-time setup: ensureDirs is called at the start of every read/write. If baseDir does not exist, mkdir is called. No test explicitly verifies that a completely new baseDir (with no flows/, runs/, preferences.json) is correctly initialized on first getFlow/appendRun/getPreferences call.

**Why it matters:** User experience: the app is expected to work out-of-the-box on a new installation. If ensureDirs fails silently or doesn't create all required directories, subsequent operations fail with confusing ENOENT errors. Confirms smooth first-time setup.

**Production code:**
```
async function ensureDirs() {
    await mkdir(flowsDir, { recursive: true });
    await mkdir(runsDir, { recursive: true });
  }
```
**Existing test** (`tests/storage.test.ts`):
```
(no excerpt)
```
**Suggested test:** unit

**Example cases:**
- First call to getFlow on nonexistent baseDir: directories are created, null is returned
- First call to appendRun on nonexistent baseDir: flows/ and runs/ created, run is persisted
- First call to getPreferences on nonexistent baseDir: directories created, default Preferences returned

**Mocks/fixtures/setup:** Create temp directory but do NOT create flows/, runs/ subdirs. Call storage.getFlow/appendRun/getPreferences. Verify directories exist afterward and operations succeed.

**Verification evidence:** grep -rn 'ensureDirs' /Users/ido/Documents/reddix/tests/ returned no results. The function at lines 27-30 creates baseDir/flows and baseDir/runs on first access. Tests use mkdtemp to pre-create baseDir, so the initialization path (mkdir on nonexistent baseDir) is never exercised. No test verifies first-time setup on completely empty baseDir.

---

### 91. isRunRecord  
`server/storage.ts` · **MEDIUM** · confidence high · storage-persistence

**Uncovered behavior:** RunRecord shape validation for edge cases: isRunRecord validates all required fields, including enum-like status and optional-but-strictly-typed endedAt/error. No unit test directly exercises isRunRecord with boundary cases: empty string id, status='pending' (unsupported), steps=null (should be array), outputFiles as object instead of array, etc.

**Why it matters:** Data integrity: invalid run records silently drop from storage. If isRunRecord wrongly accepts a record with status='pending' or missing steps, corrupted data persists. Direct unit tests of isRunRecord ensure the validation logic is bulletproof.

**Production code:**
```
function isRunRecord(value: unknown): value is RunRecord {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.id === 'string' &&
    typeof value.flowId === 'string' &&
    (value.status === 'success' || value.status === 'failed' || value.status === 'skipped' || value.status === 'running') &&
    typeof value.startedAt === 'string' &&
    (typeof value.endedAt === 'string' || value.endedAt === null) &&
    Array.isArray(value.steps) &&
    Array.isArray(value.outputFiles) &&
    (typeof value.error === 'string' || value.error === null)
  );
}
```
**Existing test** (`tests/storage.test.ts`):
```
(no excerpt)
```
**Suggested test:** unit

**Example cases:**
- isRunRecord with valid record: returns true
- isRunRecord with status='pending' (unsupported): returns false
- isRunRecord with id='' (empty string): returns true (empty strings are strings)
- isRunRecord with steps=null: returns false (must be array)
- isRunRecord with outputFiles={} (object, not array): returns false

**Mocks/fixtures/setup:** Direct unit tests calling isRunRecord with various objects, no file I/O needed.

**Verification evidence:** grep -rn 'isRunRecord' /Users/ido/Documents/reddix/tests/ returned no results. The validator at lines 143-156 validates all required fields (schemaVersion, id, flowId, status enum, startedAt, endedAt, steps array, outputFiles array, error). It is used indirectly by normalizeRunList but never directly tested with boundary cases: empty string id, status not in {success, failed, skipped, running}, steps=null, outputFiles as object, etc.

---

## Low gaps (15)

### 92. collectFieldKeys  
`server/runEngine.ts` · **LOW** · confidence high · execution-engine

**Uncovered behavior:** collectFieldKeys with an empty items array. Line 781 computes normalizedFields for step.io, but there's no test covering what happens when no items exist (e.g., a filter that drops everything, or a source that returned nothing). The function should return an empty array, but the behavior with nil engagement fields is untested.

**Why it matters:** collectFieldKeys drives the normalizedFields metadata that the UI uses to render dynamic columns. If empty arrays or partial field sets are not handled correctly, the UI preview may crash or display incorrect field availability. This is a data contract between engine and UI.

**Production code:**
```
function collectFieldKeys(items: SocialItem[]): string[] {
  const present = new Set<string>();
  for (const item of items) {
    if (item.id) present.add('id');
    if (item.url !== null) present.add('url');
    if (item.author !== null) present.add('author');
    if (item.community !== null) present.add('community');
    if (item.title !== null) present.add('title');
    if (item.body !== null) present.add('body');
    if (item.text !== '') present.add('text');
    if (item.createdAt) present.add('createdAt');
    if (item.media.length > 0) present.add('media');
    if (item.links.length > 0) present.add('links');
    for (const [key, value] of Object.entries(item.engagement)) {
      if (value !== null && value !== undefined) {
        present.add(key);
      }
    }
  }
```
**Existing test** (`tests/runEngine.test.ts`):
```
    expect(search?.io?.normalizedFields).toEqual(expect.arrayContaining(['id', 'title', 'author']));
```
**Suggested test:** unit

**Example cases:**
- collectFieldKeys([]) → returns empty array
- collectFieldKeys with items missing common fields like 'engagement' → only present fields are in result
- collectFieldKeys with one item having all fields, others missing → union of all present fields
- collectFieldKeys with items having empty arrays (media: [], links: []) → media/links NOT in result (length check)

**Mocks/fixtures/setup:** Call collectFieldKeys directly with test SocialItem arrays. Assert result set matches expected fields. Test empty array, sparse items, full items.

**Verification evidence:** grep -rn "collectFieldKeys" /Users/ido/Documents/reddix/tests/ --include="*.ts" returns no output. No direct test of the function exists. The function is private (line 815) and only tested indirectly via step.io.normalizedFields. Test at runEngineLogging.test.ts:58-75 ('logs transform input/output counts so a filter dropping everything is visible') produces outputCount: 0 but does not verify normalizedFields is correctly empty. No test exercises collectFieldKeys with an empty items array.

---

### 93. topologicalNodes  
`server/runEngine.ts` · **LOW** · confidence high · execution-engine

**Uncovered behavior:** topologicalNodes is called at line 78 but never directly unit tested. While validateFlow prevents cycles from reaching runFlow, topologicalNodes itself does not detect or handle cycles—it simply returns a partial ordering. The algorithm assumes acyclic input (guaranteed by validation). However, the function's correctness (proper ordering, all nodes included if acyclic) is not verified in isolation.

**Why it matters:** Topological sort is the core scheduling algorithm for executing nodes. A bug here (e.g., missing a node, wrong ordering) would cause silent skipping of nodes or data dependency violations. Without a unit test, regressions in this algorithm are invisible until discovered in an integration test or in production.

**Production code:**
```
function topologicalNodes(flow: FlowDefinition): FlowNodeModel[] {
  const nodesById = new Map(flow.nodes.map((node) => [node.id, node]));
  const incoming = new Map(flow.nodes.map((node) => [node.id, 0]));
  const outgoing = groupEdges(flow.edges, 'source');
  for (const edge of flow.edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }
  const queue = flow.nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0);
  const ordered: FlowNodeModel[] = [];
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index];
    ordered.push(node);
    for (const edge of outgoing.get(node.id) ?? []) {
      incoming.set(edge.target, (incoming.get(edge.target) ?? 0) - 1);
      if ((incoming.get(edge.target) ?? 0) === 0) {
        const target = nodesById.get(edge.target);
        if (target) {
          queue.push(target);
        }
      }
    }
```
**Existing test:** none.
**Suggested test:** unit

**Example cases:**
- Linear chain (A→B→C) → returns [A, B, C] in that order
- Diamond DAG (A→B,C; B→D; C→D) → D comes after B and C
- Multiple independent sources (no edges) → returns all nodes (order may vary)
- Single node with no edges → returns [node]

**Mocks/fixtures/setup:** Create FlowDefinition objects with various topologies (linear, diamond, multiple sources, single node). Call topologicalNodes and assert returned order respects all edge dependencies.

**Verification evidence:** grep -rn "topological\|Topological" /Users/ido/Documents/reddix/tests/ --include="*.ts" returns no output. No direct unit test of topologicalNodes exists. The function (line 890) is private and called once at line 78 in runFlow. It is only tested indirectly through full flow execution in runEngine.test.ts, which assumes acyclic input. The function's correctness (proper ordering, all nodes included if acyclic) is not verified in isolation.

---

### 94. groupEdges  
`server/runEngine.ts` · **LOW** · confidence high · execution-engine

**Uncovered behavior:** groupEdges is a utility called at lines 79-80 to group edges by source and target. It is never directly tested. The function handles empty edge arrays and duplicate grouping. An edge case: if flow.edges is empty, groupEdges should return an empty Map. The current tests do exercise flows with multiple edges but do not isolate groupEdges behavior.

**Why it matters:** groupEdges is used to build the edgesBySource and edgesByTarget maps that are critical for skip propagation and upstream gathering (line 138). If groupEdges incorrectly handles duplicates or order, the skip logic (markDownstreamBlocked, dependencyEdges gathering) could break silently.

**Production code:**
```
function groupEdges(edges: FlowEdgeModel[], key: 'source' | 'target'): Map<string, FlowEdgeModel[]> {
  const groups = new Map<string, FlowEdgeModel[]>();
  for (const edge of edges) {
    const group = groups.get(edge[key]);
    if (group) {
      group.push(edge);
    } else {
      groups.set(edge[key], [edge]);
    }
  }
  return groups;
```
**Existing test** (`tests/runEngine.test.ts`):
```
(no excerpt)
```
**Suggested test:** unit

**Example cases:**
- groupEdges([], 'source') → empty Map
- groupEdges([e1(A→B), e2(A→C)], 'source') → {'A': [e1, e2]}
- groupEdges([e1(A→B), e2(C→B)], 'target') → {'B': [e1, e2]}
- groupEdges with single edge → single-entry Map

**Mocks/fixtures/setup:** Direct unit test: call groupEdges with various edge lists. Assert Map structure and entry counts.

**Verification evidence:** grep -rn "groupEdges" /Users/ido/Documents/reddix/tests/ --include="*.ts" returns no output. No direct unit test of groupEdges exists. The function (line 915) is private and called at lines 79-80 in runFlow. It is only tested indirectly through full flow execution. Tests with multiple edges (runEngine.test.ts:113-158 'continues unrelated branches') exercise the function implicitly but do not verify edge grouping behavior in isolation or test empty edge arrays.

---

### 95. escapeMarkdownLabel  
`src/shared/exporters.ts` · **LOW** · confidence medium · exporters-html-redaction

**Uncovered behavior:** escapeMarkdownLabel is never directly unit tested. Only tested indirectly through serializeMarkdown integration test. No direct test for escape sequences, edge cases like empty strings, or behavior with special Markdown characters.

**Why it matters:** MEDIUM: The function is private and only tested through integration, but incorrect escaping could allow Markdown injection in labels. The test does verify escaping happens via the integration test, but direct unit test would improve clarity and catch edge cases.

**Production code:**
```
function escapeMarkdownLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/([\[\]()])/g, '\\$1').replace(/\r?\n/g, ' ');
}
```
**Existing test** (`tests/exporters.test.ts`):
```
    expect(markdown).toContain('break \\]\\(https://evil.example\\) \\[label\\]');
```
**Suggested test:** unit

**Example cases:**
- escapeMarkdownLabel('a\\b') should return 'a\\\\b'
- escapeMarkdownLabel('[link]') should escape brackets to '\\[link\\]'
- escapeMarkdownLabel('line1\nline2') should replace newline with space
- escapeMarkdownLabel('') should return empty string

**Mocks/fixtures/setup:** No mocks needed - pure string transformation

**Verification evidence:** grep -rn 'escapeMarkdownLabel' /Users/ido/Documents/reddix/tests --include='*.ts': returned zero results. Function is private (not exported) and defined at lines 72-74 of exporters.ts. Only integration test 'drops dangerous Markdown links and escapes link labels' at lines 51-63 of exporters.test.ts exercises it indirectly via serializeMarkdown with title='break ](https://evil.example) [label]', which tests bracket/paren escaping. No direct test for backslash escaping, empty strings, or newline handling. Function uses three .replace() calls for \\, []()), and \r?\n patterns. Test confirms bracket/paren escaping but not backslash or newline edge cases directly.

---

### 96. imageThumb  
`src/shared/htmlReport.ts` · **LOW** · confidence medium · exporters-html-redaction

**Uncovered behavior:** imageThumb is private and not directly tested. Integration test only checks happy path (valid image URL). No test for: (1) image with suspicious type but safe extension, (2) mixed media array (non-image followed by image), (3) SVG as image (security risk), (4) empty alt attribute (accessibility).

**Why it matters:** MEDIUM: Private function, tested via integration. IMAGE_EXTENSION regex includes svg, which can contain JavaScript. While safeHref filters the URL, SVG itself could be a vector. The empty alt attribute could be an accessibility issue.

**Production code:**
```
function imageThumb(media: SocialItem['media']): string {
  const first = media[0];
  if (!first) {
    return '';
  }
  const href = safeHref(first.url);
  if (!href) {
    return '';
  }
  const isImage = first.type === 'image' || IMAGE_EXTENSION.test(href);
  if (!isImage) {
    return '';
  }
  return `<img class="card-media" loading="lazy" alt="" src="${escapeHtml(href)}" />`;
}
```
**Existing test** (`tests/htmlReport.test.ts`):
```
  it('renders an image thumbnail only for safe image media', () => {
    const withImage = serializeHtml(
      [makeItem({ media: [{ type: 'image', url: 'https://img.example.com/a.png' }] })],
      meta
    );
    expect(withImage).toContain('src="https://img.example.com/a.png"');
```
**Suggested test:** integration

**Example cases:**
- serializeHtml with SVG media should still be escaped and safe
- serializeHtml with mixed media (video, then image) should only render the image
- serializeHtml with malicious image URL should not render img tag
- serializeHtml with empty media array should not have img tags

**Mocks/fixtures/setup:** Use makeItem helper to construct test items with various media arrays

**Verification evidence:** grep -n 'renders an image thumbnail' /Users/ido/Documents/reddix/tests/htmlReport.test.ts: test at lines 176-188. Function imageThumb is private (not exported), defined at lines 162-176 of htmlReport.ts. IMAGE_EXTENSION regex at line 30 includes svg: /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|#|$)/i. Test only checks happy path (valid https PNG) at line 178 and hostile URL rejection at line 184 (javascript: blocked by safeHref). No test for: (1) SVG files (present in regex but not tested for security implications), (2) mixed media arrays (non-image before image), (3) alt attribute accessibility (hardcoded empty alt at line 175 never tested). Only one integration test via serializeHtml covers imageThumb.

---

### 97. applyEngagementFilter with empty array input  
`src/shared/transforms.ts` · **LOW** · confidence high · normalizers-transforms

**Uncovered behavior:** Empty array input NOT TESTED: applyEngagementFilter([], { minScore: 5 }) should return []. While this is trivial (filter on empty array returns empty), it's an edge case boundary that should be proven.

**Why it matters:** LOW: edge case hygiene. Empty arrays are a standard boundary condition in transform functions. Not tested, but low risk since filter() naturally handles it.

**Production code:**
```
export function applyEngagementFilter(
  items: SocialItem[],
  settings: Record<string, unknown>
): SocialItem[] {
  const thresholds = {
    score: coerceNumber(settings.minScore, 0),
    comments: coerceNumber(settings.minComments, 0),
    replies: coerceNumber(settings.minReplies, 0),
    likes: coerceNumber(settings.minLikes, 0),
    retweets: coerceNumber(settings.minRetweets, 0),
    bookmarks: coerceNumber(settings.minBookmarks, 0),
    views: coerceNumber(settings.minViews, 0)
  };

  return items.filter((item) => {
    return Object.entries(thresholds).every(([key, threshold]) => {
      if (threshold <= 0) {
        return true;
      }
      const value = item.engagement[key as keyof SocialItem['engagement']];
      return value == null ? true : value >= threshold;
    });
  });
}
```
**Existing test** (`tests/transforms.test.ts`):
```
it('filters by engagement fields present on each platform', () => {
    expect(applyEngagementFilter(items, { minScore: 5, minLikes: 5 })).toEqual([items[0]]);
  });

  it('filters on the less-common engagement thresholds', () => {
    // minComments only excludes the reddit item (2 comments); the twitter item has
    // no comments field so it passes (absent fields never fail a threshold).
    expect(applyEngagementFilter(items, { minComments: 5 })).toEqual([items[1]]);
  });
```
**Suggested test:** unit

**Example cases:**
- applyEngagementFilter([], { minScore: 10 }) should return []
- applyEngagementFilter with all thresholds = 0 should return all items (all pass)

**Mocks/fixtures/setup:** Use existing test items or empty array; no mocks needed

**Verification evidence:** grep -r "applyEngagementFilter.*\[\]" /Users/ido/Documents/reddix/tests/transforms.test.ts: (no output) - confirms no empty array test

---

### 98. Logger.requestLogger duration precision  
`server/logger.ts` · **LOW** · confidence high · observability-lifecycle

**Uncovered behavior:** requestLogger test does not verify durationMs is present in output, nor that it's rounded correctly (Math.round). No test for edge cases: very fast requests (< 1ms), very slow requests, or rounding behavior.

**Why it matters:** If durationMs is missing from request logs, or rounding fails, operators cannot monitor request latency. If hrtime calculation has precision loss or rounding bugs, latency metrics are unreliable.

**Production code:**
```
    requestLogger() {
      return (request: Request, response: Response, next: NextFunction): void => {
        const start = process.hrtime.bigint();
        response.on('finish', () => {
          const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
          emit('info', 'request', {
            method: request.method,
            path: request.path,
            status: response.statusCode,
            durationMs: Math.round(durationMs)
          });
        });
        next();
      };
    }
```
**Existing test** (`tests/logger.test.ts`):
```
    const entry = JSON.parse(lines[0]);
    expect(entry.message).toBe('request');
    expect(entry.method).toBe('GET');
    expect(entry.path).toBe('/api/health');
    expect(entry.status).toBe(200);
```
**Suggested test:** unit

**Example cases:**
- requestLogger includes durationMs field in emitted log
- durationMs is an integer (Math.round applied)
- very fast requests (< 1ms) round correctly
- multi-second requests calculate durationMs accurately

**Mocks/fixtures/setup:** Mocked Response with 'finish' event; mock process.hrtime.bigint to control timing; capture emitted log

**Verification evidence:** Test file /Users/ido/Documents/reddix/tests/logger.test.ts lines 24-48 test requestLogger but do NOT verify durationMs. The test checks entry.message, entry.method, entry.path, entry.status but not entry.durationMs. grep -r 'durationMs' /Users/ido/Documents/reddix/tests/logger.test.ts returned zero results. The durationMs field is emitted at line 49 of logger.ts as Math.round(durationMs) but the test never asserts its presence or verifies the rounding behavior. No edge case tests for very fast requests (<1ms) or very slow requests.

---

### 99. MAX_SCHEDULE_INTERVAL_MS export  
`src/shared/schedule.ts` · **LOW** · confidence high · scheduler-throttling

**Uncovered behavior:** MAX_SCHEDULE_INTERVAL_MS is exported and used in validation schemas (server/schemas.ts, server/routes.ts) but is never tested. No test verifies that intervals above this max are rejected or clamped.

**Why it matters:** The max interval is a data integrity bound: intervals above ~1 year could cause Date overflow or very-long-in-future scheduling issues. If this bound is not enforced or tested, a large intervalMs could break the scheduler.

**Production code:**
```
export const MAX_SCHEDULE_INTERVAL_MS = 366 * 24 * 60 * 60 * 1000;
```
**Existing test** (`tests/scheduleCadence.test.ts`):
```
(no excerpt)
```
**Suggested test:** unit

**Example cases:**
- Attempt to register a flow with intervalMs > MAX_SCHEDULE_INTERVAL_MS, verify rejection or clamping
- Register with intervalMs = MAX_SCHEDULE_INTERVAL_MS, verify accepted
- Register with intervalMs = MAX_SCHEDULE_INTERVAL_MS + 1, verify rejected or clamped

**Mocks/fixtures/setup:** No special setup needed. Call scheduler.register or validation schema with large intervalMs values. Or call cronToIntervalMs with values that would exceed max.

**Verification evidence:** grep -rn "MAX_SCHEDULE_INTERVAL_MS" /Users/ido/Documents/reddix/tests --include="*.test.ts" returned no output. The constant is exported at src/shared/schedule.ts:10 and used in server/schemas.ts:28 and server/routes.ts:538 for validation, but no test file mentions MAX_SCHEDULE_INTERVAL_MS. schemas.test.ts tests schedule validation but does not test the maximum interval bounds.

---

### 100. isAllowedOrigin  
`server/cors.ts` · **LOW** · confidence high · security-middleware

**Uncovered behavior:** Null-string origin ('null') is not tested. When a sandboxed iframe or file:// document initiates a cross-origin request, the browser sends Origin: null as a string literal. This is a valid CORS case per spec but differs semantically from undefined (missing header). Current code treats it as a foreign origin (not matching allowlist), which is correct, but this specific case is not explicitly tested.

**Why it matters:** The 'null' origin is a real-world CORS edge case sent by browsers in sandbox/file contexts. If future code changes the origin check logic, lack of explicit test coverage could allow 'null' origins through if mishandled. Security boundaries should have explicit test coverage for all known attack vectors.

**Production code:**
```
export function isAllowedOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[]
): boolean {
  if (!origin) {
    return true;
  }

  return allowedOrigins.includes(origin);
}
```
**Existing test** (`tests/cors.test.ts`):
```
it('allows requests with no Origin header (same-origin / curl / health checks)', () => {
    expect(isAllowedOrigin(undefined, DEFAULT_ALLOWED_ORIGINS)).toBe(true);
  });
```
**Suggested test:** unit

**Example cases:**
- isAllowedOrigin('null', DEFAULT_ALLOWED_ORIGINS) returns false (rejected as foreign)
- isAllowedOrigin('null', allowlist=['null']) returns true (if 'null' is explicitly whitelisted)
- isAllowedOrigin(null, allowlist) [JavaScript null, not string] behavior

**Mocks/fixtures/setup:** No mocks; pure function. Pass string literal 'null' as origin parameter.

**Verification evidence:** grep -r "'null'" /Users/ido/Documents/reddix/tests/cors.test.ts returned no results. grep -r '"null"' /Users/ido/Documents/reddix/tests/cors.test.ts returned no results. isAllowedOrigin is tested with undefined (line 31), allowed origins (lines 35-36), foreign origins (line 40), spoofing attempts (lines 49-53), and env overrides (lines 57-59), but the string literal 'null' as an origin (per CORS spec for sandboxed iframes and file:// documents) is not tested.

---

### 101. parsePort  
`server/env.ts` · **LOW** · confidence high · security-middleware

**Uncovered behavior:** Boundary values MIN_PORT (1) and MAX_PORT (65535) are not explicitly tested. Test covers 0 (below MIN), 70000 (above MAX), but not 1 (at MIN) or 65535 (at MAX). These boundary values should explicitly pass validation.

**Why it matters:** Port number validation is a critical security configuration. Boundary values (1 and 65535) are the edge cases most likely to be mishandled in range checks. If the comparison operators are wrong (< vs <=), boundaries could be rejected or accepted incorrectly, breaking deployment or allowing invalid port configurations.

**Production code:**
```
export function parsePort(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
    return null;
  }
  return parsed;
}
```
**Existing test** (`tests/env.test.ts`):
```
it('rejects non-numeric, out-of-range, or fractional ports', () => {
    expect(parsePort('abc')).toBeNull();
    expect(parsePort('0')).toBeNull();
    expect(parsePort('70000')).toBeNull();
    expect(parsePort('80.5')).toBeNull();
  });
```
**Suggested test:** unit

**Example cases:**
- parsePort('1') returns 1 (MIN_PORT boundary)
- parsePort('65535') returns 65535 (MAX_PORT boundary)
- parsePort('65536') returns null (exceeds MAX_PORT)
- parsePort('0') returns null (below MIN_PORT, already covered but boundary-adjacent)

**Mocks/fixtures/setup:** No mocks; pure function.

**Verification evidence:** grep -r '65535' /Users/ido/Documents/reddix/tests/env.test.ts returned no results. grep -r 'parsePort.*1\|parsePort.*65535' /Users/ido/Documents/reddix/tests/env.test.ts returned no results. Test file env.test.ts lines 5-15 show tests for parsePort('8787') as valid, parsePort('0') as null (below MIN_PORT=1), parsePort('70000') as null (above MAX_PORT=65535), but does NOT explicitly test parsePort('1') or parsePort('65535'), the exact boundary values.

---

### 102. handler  
`server/sseHub.ts` · **LOW** · confidence high · sse-streaming

**Uncovered behavior:** Fallback remote address resolution: code tries request.ip, then request.socket?.remoteAddress, then falls back to 'unknown'. Tests never exercise the 'unknown' fallback case when both ip and socket.remoteAddress are undefined/null.

**Why it matters:** If 'unknown' is used, the clientsForRemote() count will lump all unknown sources together, potentially allowing an attacker to bypass per-remote limits by spoofing lack of IP. Testing the fallback ensures logic is sound.

**Production code:**
```
    const remoteAddress = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
    if (clientsForRemote(remoteAddress) >= maxClientsPerRemote) {
      logger?.warn('sse.remoteLimited', { remoteAddress });
      response.status(503).end();
      return;
    }
```
**Existing test** (`tests/sseHub.test.ts`):
```
  it('caps SSE connections per remote address', () => {
    const hub = createSseHub({ maxClientsPerRemote: 1 });
    const first = fakeResponse();
    const second = fakeResponse();

    hub.handler(fakeRequest({ ip: '203.0.113.10' } as Partial<Request>), first.response, vi.fn());
    hub.handler(fakeRequest({ ip: '203.0.113.10' } as Partial<Request>), second.response, vi.fn());

    expect(hub.clientCount).toBe(1);
    expect(second.status).toBe(503);
    expect(second.ended).toBe(true);
  });
```
**Suggested test:** unit

**Example cases:**
- Connect with no request.ip and no socket.remoteAddress, verify remoteAddress is 'unknown'
- Connect multiple clients with 'unknown' remoteAddress, verify they share the per-remote limit count

**Mocks/fixtures/setup:** Create fakeRequest with empty headers and no ip/socket properties. Pass it to hub.handler().

**Verification evidence:** grep -rn 'unknown.*remote\|socket.*remoteAddress' /Users/ido/Documents/reddix/tests/sseHub.test.ts returned no results. The handler function at line 103 has a fallback chain: request.ip ?? request.socket?.remoteAddress ?? 'unknown', but no test exercises the final 'unknown' fallback case. The fakeRequest() helper always sets ip: '127.0.0.1' by default (line 57), and the maxClientsPerRemote tests explicitly override ip but never test the undefined/null cases.

---

### 103. drop  
`server/sseHub.ts` · **LOW** · confidence high · sse-streaming

**Uncovered behavior:** Idle timer cleanup verification: the drop() function clears the idleTimer if present. No test verifies that after drop() is called, the timer is actually cleared (null-ed out). Tests verify clientCount decreases but not timer state.

**Why it matters:** If drop() fails to clear the idleTimer, the timeout will still fire later, calling drop() again on a stale client reference. This causes double-drop and potential resource leaks or crashes.

**Production code:**
```
  function drop(client: SseClient): void {
    clients.delete(client.id);
    if (client.idleTimer) {
      clearTimeout(client.idleTimer);
      client.idleTimer = null;
    }
    try {
      client.response.end();
    } catch {
      // Already closed; nothing to do.
    }
  }
```
**Existing test** (`tests/sseHub.test.ts`):
```
  it('removes a client when its request closes', () => {
    const hub = createSseHub();
    const res = fakeResponse();
    const req = fakeRequest();
    hub.handler(req, res.response, vi.fn());
    expect(hub.clientCount).toBe(1);

    (req as unknown as { _emit: (e: string) => void })._emit('close');
    expect(hub.clientCount).toBe(0);
  });
```
**Suggested test:** unit

**Example cases:**
- Connect a client, manually call drop(), verify idleTimer is set to null
- Connect, let idle timeout fire, verify no second drop attempt occurs
- Verify clearTimeout is called before nulling idleTimer

**Mocks/fixtures/setup:** Use vi.useFakeTimers() to spy on setTimeout/clearTimeout. Mock client object with idleTimer. Verify clearTimeout called with correct timer ID.

**Verification evidence:** grep -rn 'idleTimer\|clearTimeout' /Users/ido/Documents/reddix/tests/sseHub.test.ts returned no results. The drop() function at lines 64-75 clears client.idleTimer and sets it to null, but the test 'drops idle clients that never close cleanly' (line 110) only verifies clientCount and response.ended, not that idleTimer is actually cleared. No test inspects the timer state after drop() is called.

---

### 104. handler  
`server/sseHub.ts` · **LOW** · confidence high · sse-streaming

**Uncovered behavior:** Timer unref() call: line 119-121 calls unref() on the idleTimer to prevent it from keeping the process alive. No test verifies that unref() is actually called when available.

**Why it matters:** If unref() is not called, idle timers will keep the Node.js process alive even when no real work is happening, blocking graceful shutdown or test cleanup.

**Production code:**
```
    const id = clientId++;
    const client: SseClient = { id, response, idleTimer: null, remoteAddress };
    client.idleTimer = setTimeout(() => {
      drop(client);
    }, idleTimeoutMs);
    if (typeof client.idleTimer.unref === 'function') {
      client.idleTimer.unref();
    }
```
**Existing test** (`tests/sseHub.test.ts`):
```
  it('drops idle clients that never close cleanly', () => {
    vi.useFakeTimers();
    try {
      const hub = createSseHub({ heartbeatMs: 100, idleTimeoutMs: 250 });
      const res = fakeResponse();
      hub.handler(fakeRequest(), res.response, vi.fn());
      expect(hub.clientCount).toBe(1);

      vi.advanceTimersByTime(251);

      expect(hub.clientCount).toBe(0);
      expect(res.ended).toBe(true);
      hub.closeAll();
    } finally {
      vi.useRealTimers();
    }
  });
```
**Suggested test:** unit

**Example cases:**
- Spy on setTimeout().unref and verify it is called for idleTimer
- Verify code handles missing unref() gracefully (try-catch or typeof check)

**Mocks/fixtures/setup:** Use vi.spyOn(global, 'setTimeout') and mock the returned timer object with unref method. Verify the spy was called.

**Verification evidence:** grep -rn 'unknown.*remote\|socket.*remoteAddress' /Users/ido/Documents/reddix/tests/sseHub.test.ts returned no results. The handler function at line 103 has a fallback chain: request.ip ?? request.socket?.remoteAddress ?? 'unknown', but no test exercises the final 'unknown' fallback case. The fakeRequest() helper always sets ip: '127.0.0.1' by default (line 57), and the maxClientsPerRemote tests explicitly override ip but never test the undefined/null cases.

---

### 105. createSseHub  
`server/sseHub.ts` · **LOW** · confidence high · sse-streaming

**Uncovered behavior:** Heartbeat interval unref() call: similar to idleTimer, the heartbeat interval calls unref() at line 161-163 to avoid blocking process shutdown. No test verifies unref() is called.

**Why it matters:** Without unref(), the heartbeat setInterval prevents the process from exiting naturally, causing test hangs or production zombie processes.

**Production code:**
```
  const heartbeat = setInterval(pingAll, heartbeatMs);
  // Do not keep the process alive solely for the heartbeat.
  if (typeof heartbeat.unref === 'function') {
    heartbeat.unref();
  }
```
**Existing test** (`tests/sseHub.test.ts`):
```
  it('closeAll ends every client and clears the heartbeat', () => {
    const hub = createSseHub();
    const res = fakeResponse();
    hub.handler(fakeRequest(), res.response, vi.fn());
    hub.closeAll();
    expect(res.ended).toBe(true);
    expect(hub.clientCount).toBe(0);
  });
```
**Suggested test:** unit

**Example cases:**
- Spy on setInterval().unref and verify it is called for heartbeat
- Verify code handles missing unref() gracefully

**Mocks/fixtures/setup:** Use vi.spyOn(global, 'setInterval') and mock returned interval with unref method. Verify spy was called.

**Verification evidence:** grep -rn 'heartbeat.*unref\|unref.*heartbeat' /Users/ido/Documents/reddix/tests/ returned no results. The createSseHub function at lines 161-163 calls unref() on the heartbeat interval to prevent blocking process shutdown, but no test verifies that unref() is actually called. The 'closeAll ends every client and clears the heartbeat' test (line 189) verifies clearInterval is called but not unref().

---

### 106. syncDirectory  
`server/storage.ts` · **LOW** · confidence high · storage-persistence

**Uncovered behavior:** Directory fsync fallback: syncDirectory silently ignores errors when dir.sync() is unavailable (non-POSIX filesystems like some Windows/cloud storage). No test verifies that (a) the function completes without throwing, (b) handle is closed even on error, or (c) durability guarantee is gracefully degraded on unsupported filesystems.

**Why it matters:** Platform compatibility and durability: syncDirectory is called after every write to guarantee durability. If fsync fails loudly on non-POSIX systems, the storage layer crashes. The code silently downgrades; tests should confirm that behavior works on mock filesystems without fsync support.

**Production code:**
```
async function syncDirectory(dir: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(dir, 'r');
    await handle.sync();
  } catch {
    // Directory fsync is not available on every filesystem. The temp+rename is
    // still atomic; skip only the durability flush when the platform refuses it.
  } finally {
    if (handle) {
      await handle.close().catch(() => {});
    }
  }
}
```
**Existing test** (`tests/storage.test.ts`):
```
(no excerpt)
```
**Suggested test:** unit

**Example cases:**
- syncDirectory on filesystem that supports fsync: completes and handle closed
- syncDirectory on filesystem without dir fsync support (mocked error): silently completes without throwing
- syncDirectory on directory that does not exist: catches error and completes gracefully

**Mocks/fixtures/setup:** Mock open() to throw EINVAL or ENOTSUP when opening directory for fsync. Call syncDirectory(nonexistent). Verify no throw and proper cleanup.

**Verification evidence:** grep -rn 'syncDirectory\|fsync' /Users/ido/Documents/reddix/tests/ returned no results. The function at lines 213-226 gracefully degrades durability on non-POSIX filesystems by catching all errors. No test verifies that (a) function completes without throwing on sync errors, (b) handle is closed even on error (finally block at line 222), or (c) directory sync is called.

---
