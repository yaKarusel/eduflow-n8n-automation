#!/usr/bin/env bash
set -Eeuo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/common.sh"

compose ps
compose ps --format json | grep -q '"Health":"healthy"' || { echo "No healthy Compose service reported" >&2; exit 1; }
psql_eduflow -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('contacts','leads','messages','comments','content_items','publications','publication_metrics','workflow_events','idempotency_keys','error_logs','daily_reports','outbound_requests');" | grep -qx 12
docker exec "$(mock_container)" node -e "fetch('http://127.0.0.1:8080/health').then(async r=>{if(!r.ok)process.exit(1);console.log(await r.text())})"
echo "EduFlow health checks passed"
