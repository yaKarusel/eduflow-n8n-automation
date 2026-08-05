# Data model

| Table | Purpose / key invariant |
|---|---|
| `contacts` | One contact per source and external user ID |
| `leads` | One lead per contact/source with deterministic score/status |
| `messages` | Unique inbound external event and unique outbound message IDs |
| `comments` | One row per external comment ID |
| `content_items` | Draft/approval/publication state machine by public ID |
| `publications` | One external publication per content item |
| `publication_metrics` | One metric snapshot per publication/day |
| `workflow_events` | Correlated lifecycle and processing duration per external event |
| `idempotency_keys` | First-writer-wins side-effect guard |
| `error_logs` | Sanitized incidents and fingerprints |
| `daily_reports` | One Markdown/JSON analytics report per date |
| `outbound_requests` | Durable ledger for pending/sent/failed/skipped calls |

Migrations are ordered and idempotent. Business writes use `eduflow_process_dm`, `eduflow_process_comment`, `eduflow_create_content`, `eduflow_decide_content`, `eduflow_record_publication`, and `eduflow_daily_metrics`. In a shared production database, n8n should connect through a restricted EduFlow role while migrations remain owned by an administrative role.

`v_daily_funnel` exposes the last 90 days for portfolio queries. Example queries are under `database/queries/`.
