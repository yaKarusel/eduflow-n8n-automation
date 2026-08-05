#!/usr/bin/env bash
set -Eeuo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/common.sh"
mock=$(mock_container)
docker exec -i "${mock}" node src/cli.js /mock/events/dm < fixtures/instagram-dm-price.json
docker exec -i "${mock}" node src/cli.js /mock/events/comment < fixtures/instagram-comment-guide.json
sleep 3
psql_eduflow -P pager=off < database/queries/demo-summary.sql
