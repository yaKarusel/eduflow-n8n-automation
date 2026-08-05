# Troubleshooting

## Webhook returns 404 after import

The CLI publishes database state but a running n8n process registers webhooks only after restart. Restart n8n, wait for all five `Activated workflow` log lines, then retry.

## Webhook returns 503 during startup

The health endpoint can become healthy before workflow activation/database readiness completes on a small VPS. Wait for `Editor is now accessible` and the activation lines.

## Mock sends 422 with an empty content body

Confirm the imported content workflow contains `Has Due Content` and `Has Publication for Metrics`. These guards prevent empty PostgreSQL result sets from reaching HTTP nodes.

## Task runner hangs

Do not add Code nodes to the current deployed version. EduFlow production JSON is deliberately no-code. See the compatibility note in `SECURITY.md`.

## Real external APIs fail but mock works

Check `META_MODE`, permissions/token expiry, Graph API version, account ID, VLESS egress health, and provider-specific rate-limit headers. Do not disable the proxy globally; host traffic is intentionally unaffected.

## Duplicate event does nothing

That is expected. Inspect `idempotency_keys`, `workflow_events`, and `outbound_requests`. Use a new external ID for another demonstration.
