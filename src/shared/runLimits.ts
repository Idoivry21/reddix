/**
 * Isomorphic caps on run-record size. Lives in the shared core so the backend
 * that builds the sample (runEngine) and the frontend that previews it
 * (ConsolePanel) enforce the SAME bound and can never disagree on "showing N".
 */

/** Max rows carried on a run so payloads/SSE/persisted records stay bounded. */
export const MAX_SAMPLE_ROWS = 50;

/** Max items persisted in a RunStep.io sample. Reuses the per-flow sample cap so
 *  per-node and per-flow previews share one bound. */
export const MAX_STEP_SAMPLE_ITEMS = MAX_SAMPLE_ROWS;

/** Cap on long text fields in a persisted per-node sample item, to bound record size. */
export const MAX_SAMPLE_TEXT_CHARS = 500;

/**
 * Max per-item CLI calls a single enrichment block fans out to in one run. When
 * an enrichment block (e.g. Tweet Detail) has a blank input-bound field and is
 * wired to an upstream source, it runs once per distinct upstream item. This cap
 * bounds run duration and respects the CLIs' own rate limits; items beyond it are
 * skipped and surfaced in the step summary (never silently dropped).
 */
export const MAX_FANOUT_CALLS = 50;
