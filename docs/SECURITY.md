# Security model

## Controls represented in the repository

- TLS terminates at Caddy with HSTS and restrictive browser headers.
- PostgreSQL and the mock API are internal-only; only the reverse proxy publishes ports.
- Images are digest-pinned. Containers use resource/PID limits, bounded logs, `no-new-privileges`, dropped capabilities, and read-only filesystems where practical.
- n8n credentials are encrypted with a deployment-specific key. Database, ingress, approval, and optional provider secrets live only in `.env` mode `0600`.
- Successful execution payload storage is disabled. Business logging stores correlation metadata and sanitized response summaries.
- The public API, templates, community packages, version notifications, diagnostics, and personalization are disabled by default.
- SQL values are parameter-bound. Idempotency is enforced by database constraints and transactions, not timing.
- Mock ingress and protected content/analytics endpoints require high-entropy tokens. Media URLs require HTTPS and an allow-list.
- AI, Telegram, and live Meta fields are disabled or empty by default.

## Secret handling

Never commit `.env`, credential exports, database dumps, provider payload logs, or private keys. Generate new values per environment and rotate any credential that has appeared in chat, logs, screenshots, or issue reports.

Before a public release:

```bash
git grep -n -i -E 'BEGIN.*PRIVATE KEY|(PASSWORD|TOKEN|SECRET)=.{20,}'
git status --ignored --short
make security-audit
```

Use an organization secret manager for client deployments. Enable 2FA for n8n and infrastructure accounts, and keep Meta permissions least-privilege.

## Known boundary

EduFlow workflows contain no Code nodes and therefore do not depend on a JavaScript task-runner deployment. If Code nodes are added later, deploy external runners according to the current n8n guidance and repeat the threat model.

Live Meta onboarding additionally requires webhook signature verification, app review, current permission checks, a token-rotation runbook, and client-owned Business assets.
