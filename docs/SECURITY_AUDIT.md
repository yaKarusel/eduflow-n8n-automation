# Security audit disposition

Final audit date: 2026-08-05. `n8n audit` exited successfully after the production hardening restart.

## Instance controls

The final report confirms that community packages, version notifications, workflow templates, the public API, and diagnostics are disabled. The default high-risk local command/file nodes are excluded. Only Caddy publishes the n8n HTTPS endpoint; PostgreSQL and the mock API have no host port.

## Database heuristic

The n8n auditor reports 15 PostgreSQL nodes as lacking Query Parameters. This is an auditor heuristic for expression-backed parameters: every dynamic query in the source uses `$1…$N` placeholders and `parameters.options.queryReplacement`; no webhook value is concatenated into SQL. `tests/validate-workflows.mjs` now fails the build if a PostgreSQL node contains a placeholder without a Query Parameters binding.

## Official risky nodes

Eight HTTP Request nodes are reported because they can make outbound requests by design. Their destinations are configured Meta/mock or optional Telegram endpoints, and the n8n container's full egress is isolated through the dedicated VLESS network namespace. Tokens come from the root-only environment file and are absent from workflow JSON and logs.

These two findings are documented design requirements, not unresolved secrets or public-network exposures. Re-run `make security-audit` and `make test` after workflow changes.
