#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR=${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
cd "${PROJECT_DIR}"
set -a
# shellcheck disable=SC1091
source .env
set +a

umask 077
install -d -m 0700 tmp
credential_file=tmp/eduflow-postgres-credential.json
cat > "${credential_file}" <<EOF
[{"id":"EFPOSTGRES000001","name":"EduFlow PostgreSQL","type":"postgres","data":{"host":"postgres","database":"eduflow","user":"eduflow","password":"${POSTGRES_PASSWORD}","port":5432,"ssl":"disable"}}]
EOF

docker exec -i n8n sh -c 'cat > /tmp/eduflow-postgres-credential.json && chown node:node /tmp/eduflow-postgres-credential.json' < "${credential_file}"
docker exec -u node n8n n8n import:credentials \
  --input=/tmp/eduflow-postgres-credential.json --projectId="${N8N_PROJECT_ID}"
docker exec n8n rm -f /tmp/eduflow-postgres-credential.json
rm -f "${credential_file}"

docker exec n8n rm -rf /tmp/eduflow-workflows
docker exec n8n mkdir -p /tmp/eduflow-workflows
for workflow_file in workflows/*.json; do
  workflow_name=$(basename "${workflow_file}")
  docker exec -i n8n sh -c "cat > /tmp/eduflow-workflows/${workflow_name}" < "${workflow_file}"
done
docker exec -u node n8n n8n import:workflow --separate \
  --input=/tmp/eduflow-workflows --projectId="${N8N_PROJECT_ID}" --activeState=false
docker exec n8n rm -rf /tmp/eduflow-workflows

for workflow_id in EFERROR000000001 EFDMLEAD00000001 EFCOMMENT0000001 EFCONTENT0000001 EFANALYTICS00001; do
  docker exec -u node n8n n8n publish:workflow --id="${workflow_id}"
done

echo "EduFlow credentials imported and five workflows published"
