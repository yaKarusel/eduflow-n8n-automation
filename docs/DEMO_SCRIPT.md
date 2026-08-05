# Five-minute demo script

1. Show the five workflow JSON files and explain that the fixed IDs make imports reproducible.
2. Open workflow 01 in n8n: point out ingress authentication, the PostgreSQL transaction, the duplicate branch, retrying HTTP node, and success/failure ledgers.
3. Run `make demo`; show the contact, scored lead, inbound message, correlation ID, and outbound reply.
4. Open workflow 03; create and approve a content fixture, then show `PUBLISHED` plus the deterministic mock publication ID.
5. Run `make test`; explain that the suite actively forces a one-shot 429 and persistent 500, then checks database state rather than trusting HTTP status alone.
6. Show workflow 04 and the daily Markdown/JSON report produced from business tables.
7. Close with [LIVE_MODE.md](LIVE_MODE.md): client credentials and Meta verification are controlled onboarding steps, while the mock-backed architecture is reproducible today.

## Thirty-second version

> EduFlow is a five-workflow n8n system for an online school. It qualifies Instagram leads, converts comments, manages content approval, builds daily analytics, and centralizes errors. I designed it around PostgreSQL transactions and idempotency, so duplicate webhooks do not duplicate replies. A deterministic provider simulator lets me prove 429 retries, terminal 500 handling, publishing, and analytics without touching a real client account. The whole stack is reproducible in Docker and covered by acceptance tests.
