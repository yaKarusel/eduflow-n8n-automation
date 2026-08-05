#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR=${PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}
cd "${PROJECT_DIR}"
umask 077

if [[ ! -f .env ]]; then
  cp .env.example .env
  sed -i "s/CHANGE_ME_RANDOM_DATABASE_PASSWORD/$(openssl rand -hex 32)/" .env
  sed -i "s/CHANGE_ME_RANDOM_64_HEX/$(openssl rand -hex 32)/" .env
  sed -i "s/CHANGE_ME_RANDOM_VERIFY_TOKEN/$(openssl rand -hex 24)/" .env
  sed -i "s/CHANGE_ME_RANDOM_MOCK_TOKEN/$(openssl rand -hex 32)/" .env
  sed -i "s/CHANGE_ME_RANDOM_APPROVAL_SECRET/$(openssl rand -hex 32)/" .env
  chmod 0600 .env
  echo "Created .env with random secrets. Set DOMAIN/N8N_HOST/WEBHOOK_URL before public deployment." >&2
fi

# shellcheck disable=SC1091
source scripts/common.sh
compose config --quiet
compose up -d --build --wait --wait-timeout 240
for migration in database/migrations/*.sql; do
  psql_eduflow < "${migration}"
done
echo "EduFlow standalone services and database are ready"
if [[ -n ${N8N_PROJECT_ID:-} ]]; then
  scripts/import-workflows.sh
else
  echo "Create the first n8n owner, set N8N_PROJECT_ID in .env, then run make import-workflows."
fi
