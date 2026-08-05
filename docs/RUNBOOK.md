# Operations runbook

## Routine checks

```bash
make status
make health
docker stats --no-stream
git status --short
```

The mock API and PostgreSQL should have no published host port. For the default HTTPS profile, only Caddy should publish `80`, `443`, and `443/udp`.

## Logs

```bash
docker compose logs --tail=200 n8n
docker compose logs --tail=200 mock-api
docker compose exec mock-api tail -100 /data/requests.jsonl
```

The JSONL mock log is bounded and redacts common secret fields. Docker logs rotate at 10 MB × 3.

## Backup and restore

`make backup` creates and verifies a custom-format database dump, a Git bundle, and SHA-256 checksums. `.env` is deliberately excluded.

Restore is guarded and drops only the `public` schema in the configured EduFlow database:

```bash
RESTORE_CONFIRM=RESTORE_EDUFLOW_DATABASE \
  make restore FILE=backups/TIMESTAMP/eduflow.dump
```

Always create a fresh backup and verify the selected file before restore.

## Updates

Run `make update-check`. Do not switch to floating image tags or deploy unattended updates. Review release notes, update digests in Git, back up, validate Compose, deploy, then run `make test`.

## Incident response

1. Set `META_MODE=mock` and recreate n8n to stop live provider calls.
2. Inspect `error_logs`, `workflow_events`, and `outbound_requests` by correlation ID.
3. Confirm the simulator failure mode is `normal`.
4. Run `make health`, then replay one uniquely identified fixture.
5. Rotate provider and ingress credentials if disclosure is suspected.
6. Restore only when database integrity is affected; idempotency keys normally make webhook replay safe.
