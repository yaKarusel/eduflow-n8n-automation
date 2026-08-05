#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR=${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
cd "${PROJECT_DIR}"

if [[ ! -f .env ]]; then
  echo "Missing ${PROJECT_DIR}/.env; copy .env.example and set secrets" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source .env
set +a

compose() {
  docker compose --env-file .env -f "${COMPOSE_FILE:-docker-compose.yml}" "$@"
}

container_id() {
  compose ps -q "$1"
}

postgres_container() {
  local value
  value=$(container_id postgres 2>/dev/null || true)
  [[ -n ${value} ]] && printf '%s' "${value}" || printf '%s' n8n-postgres
}

n8n_container() {
  local value
  value=$(container_id n8n 2>/dev/null || true)
  [[ -n ${value} ]] && printf '%s' "${value}" || printf '%s' n8n
}

mock_container() {
  local value
  value=$(container_id mock-api 2>/dev/null || true)
  [[ -n ${value} ]] && printf '%s' "${value}" || printf '%s' eduflow-mock-api
}

psql_eduflow() {
  local pg
  pg=$(postgres_container)
  if docker exec "${pg}" psql -U n8n -d eduflow -Atqc 'SELECT 1' >/dev/null 2>&1; then
    docker exec -i "${pg}" psql -U n8n -d eduflow -v ON_ERROR_STOP=1 "$@"
  else
    docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD}" "${pg}" psql -U "${POSTGRES_USER:-eduflow}" -d "${POSTGRES_DB:-eduflow}" -v ON_ERROR_STOP=1 "$@"
  fi
}

wait_for_sql() {
  local query=$1 expected=$2 attempts=${3:-30} result=''
  for ((index=1; index<=attempts; index+=1)); do
    result=$(printf '%s\n' "${query}" | psql_eduflow -At 2>/dev/null || true)
    [[ ${result} == "${expected}" ]] && return 0
    sleep 1
  done
  echo "Timed out waiting for SQL condition; last result: ${result}" >&2
  return 1
}
