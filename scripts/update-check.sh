#!/usr/bin/env bash
set -Eeuo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/common.sh"
echo "Configured images:"
compose config --images
echo
echo "Installed n8n version:"
docker exec "$(n8n_container)" n8n --version
echo
echo "No images are pulled automatically. Review release notes and change pinned digests in Git before upgrading."
