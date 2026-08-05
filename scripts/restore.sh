#!/usr/bin/env bash
set -Eeuo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/common.sh"

dump=${1:?Usage: scripts/restore.sh backups/TIMESTAMP/eduflow.dump}
resolved_dump=$(realpath "${dump}")
resolved_backups=$(realpath backups)
[[ ${resolved_dump} == "${resolved_backups}"/* && -f ${resolved_dump} ]] || { echo "Restore file must be under ${resolved_backups}" >&2; exit 2; }
[[ ${RESTORE_CONFIRM:-} == RESTORE_EDUFLOW_DATABASE ]] || { echo "Set RESTORE_CONFIRM=RESTORE_EDUFLOW_DATABASE to acknowledge destructive restore" >&2; exit 2; }
pg=$(postgres_container)
psql_eduflow -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
if docker exec "${pg}" psql -U n8n -d eduflow -Atqc 'SELECT 1' >/dev/null 2>&1; then
  docker exec -i "${pg}" pg_restore -U n8n -d eduflow --no-owner --no-privileges < "${resolved_dump}"
else
  docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD}" "${pg}" pg_restore -U "${POSTGRES_USER:-eduflow}" -d "${POSTGRES_DB:-eduflow}" --no-owner --no-privileges < "${resolved_dump}"
fi
echo "EduFlow database restored from ${resolved_dump}"
