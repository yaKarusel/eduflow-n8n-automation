#!/usr/bin/env bash
set -Eeuo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/common.sh"
psql_eduflow < database/seeds/001_demo_seed.sql
echo "EduFlow demo seed applied"
