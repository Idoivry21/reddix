# Security Policy

## Supported Versions

Only the current `main` branch is supported while the project is pre-1.0.

## Reporting a Vulnerability

Use GitHub private vulnerability reporting for this repository when available.
If private reporting is not enabled, open a minimal public issue asking for a
maintainer security contact and do not include exploit details, tokens, private
data, or a working proof of concept in the issue.

Useful reports include:

- Affected version or commit.
- Impact and reachable attack path.
- Local reproduction steps using test credentials or synthetic data.
- Whether the issue can expose secrets, execute commands, escape
  `REDDIX_DATA_DIR`, bypass CORS/CSRF controls, or write to social providers.

## Scope

In scope:

- Command execution safety around `rdt` and `twitter` CLI invocations.
- Secret redaction in logs, SSE payloads, run records, exports, and UI.
- Path traversal or symlink escapes from local data/artifact storage.
- Escaping, link sanitization, and CSP behavior for generated HTML reports.
- Outbound webhook delivery, including HTTPS enforcement, bearer-token
  redaction, origin-only URL masking in user-visible output, redirect blocking,
  and rejection of obvious local/private destinations.
- Host-header allowlisting, CORS, CSRF, request-body limits, rate limiting,
  scheduler, and local API abuse paths.

Out of scope:

- Vulnerabilities in third-party CLIs unless Reddix amplifies or mishandles
  their behavior.
- Social platform account policy issues unrelated to Reddix code.
- Reports requiring access to someone else's local machine or credentials.
