# Workflow reference

## 01 — DM Lead Qualification

Accepts the direct fixture shape and Meta's nested messaging shape. PostgreSQL derives `pricing`, `consultation`, `course_interest`, or `general`, applies a deterministic score, creates/updates contact and lead records, stores the inbound message, and reserves the reply. Scores at or above `HOT_LEAD_THRESHOLD` become `HOT`. Telegram manager alerts are skipped unless explicitly enabled.

## 02 — Comment to Lead

Matches guide/trial lesson/course/Python/education/check-list keywords. Unmatched comments are stored as `IGNORED` without contact, lead, or reply. Actionable comments create a lead and exactly one private reply. Re-delivery of the same comment ID is side-effect free.

## 03 — Content Approval and Publishing

- `POST /webhook/eduflow/content/create` requires the mock ingress token, required fields, supported media type, HTTPS URL, and an allow-listed media host.
- `POST /webhook/eduflow/content/decision` requires `APPROVAL_SECRET` and `approve`/`reject`.
- Approved immediate or due content is published. The five-minute schedule uses `FOR UPDATE SKIP LOCKED` to avoid double claims.
- Mock mode performs one deterministic call. Live mode creates a Meta media container and then calls `media_publish`.
- A six-hour schedule collects publication metrics for the last 30 days.

## 04 — Daily Analytics

Runs at 09:00 server timezone. PostgreSQL computes contacts, leads, hot leads, messages, comments, replies, handoffs, publications, errors, conversions, processing time, and the best publication. One Markdown/JSON row is upserted into `daily_reports`; optional Telegram delivery follows.

## 05 — Central Error Handler

All other workflows reference this workflow by fixed ID. It stores the workflow/execution/node, severity, HTTP status, bounded message, stable fingerprint, correlation ID, and a details allow-list. Tokens, authorization fields, request bodies, and credentials are not stored.

## Fixed IDs

- `EFDMLEAD00000001`
- `EFCOMMENT0000001`
- `EFCONTENT0000001`
- `EFANALYTICS00001`
- `EFERROR000000001`
- PostgreSQL credential: `EFPOSTGRES000001`
