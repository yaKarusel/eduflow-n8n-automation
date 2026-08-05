# Portfolio presentation

## Problem

An online school loses leads when Instagram DMs and keyword comments are handled manually, content approvals live in chat, and marketing reports require spreadsheet work. Webhooks are delivered more than once and provider APIs rate-limit or fail, so a simple happy-path automation can create duplicate messages and inconsistent CRM state.

## Solution

EduFlow is a five-workflow n8n system backed by PostgreSQL. It qualifies and scores leads, converts comments, manages content approval/publication, produces daily funnel analytics, and centralizes sanitized errors. A deterministic Meta simulator makes the full portfolio demonstrable without real social-media credentials.

## Engineering highlights

- First-writer-wins idempotency in the database rather than process memory.
- Parameterized SQL and explicit state machines.
- Three-attempt retry behavior with 429 and terminal 500 acceptance tests.
- Correlation IDs across webhook, business tables, outbound ledger, and mock logs.
- Mock/live switching through environment configuration without workflow duplication.
- Resource-aware deployment that adds only one small container to the existing 2 GB VPS.
- Git-defined fixed workflow and credential IDs for repeatable imports.
- Operations package: health checks, tests, audit, backups, guarded restore, update policy and live-mode handoff.

## Demonstrated result

The VPS acceptance run created HOT leads and replies from fresh events, ignored a non-actionable comment, retried a 429 successfully, recorded three failed 500 attempts, published approved content, and stored a daily Markdown/JSON report. All five workflows are visible and published in n8n.

## Honest production boundary

Mock mode is production-like and complete. Live Meta credentials, app review, request-signature verification and API-version validation belong to the client onboarding phase and are not falsely presented as tested.
