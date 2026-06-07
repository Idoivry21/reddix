/**
 * Isomorphic caps on run-record size. Lives in the shared core so the backend
 * that builds the sample (runEngine) and the frontend that previews it
 * (ConsolePanel) enforce the SAME bound and can never disagree on "showing N".
 */

/** Max rows carried on a run so payloads/SSE/persisted records stay bounded. */
export const MAX_SAMPLE_ROWS = 50;
