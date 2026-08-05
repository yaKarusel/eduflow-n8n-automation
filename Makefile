SHELL := /bin/bash

.PHONY: setup start stop restart status logs health import-workflows seed demo test backup restore update-check security-audit generate-workflows

setup:
	./scripts/setup.sh

start:
	docker compose up -d --build --wait --wait-timeout 240

stop:
	docker compose stop

restart:
	docker compose restart

status:
	docker compose ps

logs:
	docker compose logs --tail=200 -f

health:
	./scripts/health.sh

import-workflows:
	./scripts/import-workflows.sh

generate-workflows:
	node scripts/generate-workflows.mjs

seed:
	./scripts/seed.sh

demo:
	./scripts/demo.sh

test:
	./scripts/test.sh

backup:
	./scripts/backup.sh

restore:
	@test -n "$(FILE)" || (echo 'Usage: make restore FILE=backups/TIMESTAMP/eduflow.dump' >&2; exit 2)
	./scripts/restore.sh "$(FILE)"

update-check:
	./scripts/update-check.sh

security-audit:
	./scripts/security-audit.sh
