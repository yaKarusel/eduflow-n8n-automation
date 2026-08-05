#!/usr/bin/env bash
set -Eeuo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/common.sh"

docker exec "$(n8n_container)" n8n audit
echo
echo "Published host ports:"
docker ps --format '{{.Names}} {{.Ports}}' | grep -E '(^n8n|eduflow)' || true
echo
echo "Compose security settings:"
compose config | grep -E 'read_only:|no-new-privileges|cap_drop:|mem_limit:|pids_limit:' || true
