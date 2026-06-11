import type { ProviderId } from './types';

/**
 * Single source of truth for per-provider display, CLI, and node-namespace
 * metadata. Call sites that previously hard-coded the `twitter`→`x` rename, the
 * `reddit.`/`twitter.` node prefixes, or the `rdt`/`twitter` executables read
 * from here instead, so a future provider rename or addition touches one place.
 *
 * Lives in the isomorphic shared core (no React / frontend-only types), because
 * both the backend (routes, command builders, report) and the frontend consume it.
 */
export interface ProviderMeta {
  /** Canonical id used throughout the data contract. */
  id: ProviderId;
  /** Full display label (palette group, menus). */
  label: string;
  /** Short badge label shown on report cards / node eyebrows. */
  badge: string;
  /** Node-type namespace prefix (e.g. `reddit.`); absent for local-only providers. */
  nodePrefix?: string;
  /** CLI binary that backs this provider; absent for local-only providers. */
  executable?: 'rdt' | 'twitter';
}

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  reddit: { id: 'reddit', label: 'Reddit', badge: 'reddit', nodePrefix: 'reddit.', executable: 'rdt' },
  twitter: { id: 'twitter', label: 'X / Twitter', badge: 'x', nodePrefix: 'twitter.', executable: 'twitter' },
  local: { id: 'local', label: 'Local', badge: 'local' }
};

/** A provider backed by an external CLI — guaranteed to carry a prefix + executable. */
export interface CliProviderMeta extends ProviderMeta {
  nodePrefix: string;
  executable: 'rdt' | 'twitter';
}

/** Providers spawned via a CLI, in canonical order (reddit, twitter). */
export const CLI_PROVIDERS: CliProviderMeta[] = Object.values(PROVIDER_META).filter(
  (meta): meta is CliProviderMeta => meta.executable !== undefined && meta.nodePrefix !== undefined
);
