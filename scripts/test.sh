#!/usr/bin/env bash
set -Eeuo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/common.sh"

mock=$(mock_container)
stamp=$(date -u +%s%N)
tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/eduflow-test.XXXXXX")
cleanup() {
  printf '%s' '{"mode":"normal"}' | docker exec -i "${mock}" node src/cli.js /admin/failure-mode >/dev/null 2>&1 || true
  find "${tmp_dir}" -type f -delete 2>/dev/null || true
  rmdir "${tmp_dir}" 2>/dev/null || true
}
trap cleanup EXIT

node_command=${NODE_COMMAND:-node}
if command -v "${node_command}" >/dev/null; then
  "${node_command}" tests/validate-workflows.mjs
else
  python3 - <<'PY'
import glob,json
files=glob.glob('workflows/*.json')
assert len(files)==5
for f in files: json.load(open(f,encoding='utf-8'))
print('Workflow JSON validation passed')
PY
fi

dm_id="accept-dm-${stamp}"
comment_id="accept-comment-${stamp}"
rate_id="accept-429-${stamp}"
fail_id="accept-500-${stamp}"
content_id="accept-content-${stamp}"

echo "Acceptance: DM success and deduplication"
sed "s/demo-dm-price-001/${dm_id}/" fixtures/instagram-dm-price.json > "${tmp_dir}/dm.json"
docker exec -i "${mock}" node src/cli.js /mock/events/dm < "${tmp_dir}/dm.json" >/dev/null
wait_for_sql "SELECT status FROM workflow_events WHERE external_event_id='${dm_id}';" COMPLETED
docker exec -i "${mock}" node src/cli.js /mock/events/dm < "${tmp_dir}/dm.json" >/dev/null
wait_for_sql "SELECT count(*) FROM messages WHERE external_event_id='${dm_id}';" 1

echo "Acceptance: comment-to-lead reply"
sed "s/demo-comment-guide-001/${comment_id}/" fixtures/instagram-comment-guide.json > "${tmp_dir}/comment.json"
docker exec -i "${mock}" node src/cli.js /mock/events/comment < "${tmp_dir}/comment.json" >/dev/null
wait_for_sql "SELECT status FROM workflow_events WHERE external_event_id='${comment_id}';" COMPLETED

echo "Acceptance: HTTP 429 retry"
printf '%s' '{"mode":"rate_limit_once"}' | docker exec -i "${mock}" node src/cli.js /admin/failure-mode >/dev/null
sed "s/demo-dm-consultation-001/${rate_id}/" fixtures/instagram-dm-consultation.json > "${tmp_dir}/rate.json"
docker exec -i "${mock}" node src/cli.js /mock/events/dm < "${tmp_dir}/rate.json" >/dev/null
wait_for_sql "SELECT status FROM outbound_requests WHERE idempotency_key='dm-reply:${rate_id}';" SENT

echo "Acceptance: HTTP 500 failure capture"
printf '%s' '{"mode":"always_500"}' | docker exec -i "${mock}" node src/cli.js /admin/failure-mode >/dev/null
sed "s/demo-dm-failure-001/${fail_id}/" fixtures/instagram-dm-failure.json > "${tmp_dir}/fail.json"
docker exec -i "${mock}" node src/cli.js /mock/events/dm < "${tmp_dir}/fail.json" >/dev/null
wait_for_sql "SELECT status FROM outbound_requests WHERE idempotency_key='dm-reply:${fail_id}';" FAILED
wait_for_sql "SELECT count(*) FROM error_logs WHERE sanitized_details->>'event_id'='${fail_id}';" 1
printf '%s' '{"mode":"normal"}' | docker exec -i "${mock}" node src/cli.js /admin/failure-mode >/dev/null

echo "Acceptance: content approval and publication"
sed "s/demo-content-python-001/${content_id}/" fixtures/content-create.json > "${tmp_dir}/content.json"
sed "s/demo-content-python-001/${content_id}/" fixtures/content-approve.json > "${tmp_dir}/approve.json"
docker exec -i "${mock}" node src/cli.js /n8n/content/create < "${tmp_dir}/content.json" >/dev/null
wait_for_sql "SELECT status FROM content_items WHERE public_id='${content_id}';" DRAFT
docker exec -e APPROVAL_SECRET="${APPROVAL_SECRET}" -i "${mock}" node src/cli.js /n8n/content/decision < "${tmp_dir}/approve.json" >/dev/null
wait_for_sql "SELECT status FROM content_items WHERE public_id='${content_id}';" PUBLISHED

echo "Acceptance: analytics and central error handler"
printf '{"report_date":"%s"}' "$(date -u +%F)" | docker exec -i "${mock}" node src/cli.js /n8n/analytics/run >/dev/null
wait_for_sql "SELECT count(*) FROM daily_reports WHERE report_date=current_date;" 1

before_errors=$(psql_eduflow -Atqc "SELECT count(*) FROM error_logs WHERE workflow_name='04 EduFlow - Daily Analytics';")
printf '%s' '{"report_date":"not-a-date"}' | docker exec -i "${mock}" node src/cli.js /n8n/analytics/run >/dev/null
wait_for_sql "SELECT count(*) FROM error_logs WHERE workflow_name='04 EduFlow - Daily Analytics';" "$((before_errors+1))"

echo "EduFlow acceptance suite passed: dedup, comment, 429 retry, 500 failure, content, analytics, central error handler"
