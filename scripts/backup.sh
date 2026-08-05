#!/usr/bin/env bash
set -Eeuo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/common.sh"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
destination="backups/${stamp}"
install -d -m 0700 "${destination}"
pg=$(postgres_container)
if docker exec "${pg}" psql -U n8n -d eduflow -Atqc 'SELECT 1' >/dev/null 2>&1; then
  docker exec "${pg}" pg_dump -U n8n -d eduflow -Fc > "${destination}/eduflow.dump"
else
  docker exec -e PGPASSWORD="${POSTGRES_PASSWORD}" "${pg}" pg_dump -U "${POSTGRES_USER:-eduflow}" -d "${POSTGRES_DB:-eduflow}" -Fc > "${destination}/eduflow.dump"
fi
git bundle create "${destination}/repository.bundle" --all
(cd "${destination}" && sha256sum eduflow.dump repository.bundle > SHA256SUMS && sha256sum -c SHA256SUMS)
docker exec -i "${pg}" pg_restore -l < "${destination}/eduflow.dump" >/dev/null
git bundle verify "${destination}/repository.bundle" >/dev/null
chmod 0600 "${destination}"/*
echo "Backup created and verified in ${destination}; .env secrets are intentionally excluded"
