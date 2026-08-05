# Testing

## Acceptance suite

`make test` validates all five JSON files and executes uniquely named events against the internal mock API. It asserts:

1. Five unique workflow IDs, valid edges, correct error-workflow references, no Code nodes.
2. DM state becomes `COMPLETED` and duplicate delivery leaves one inbound message.
3. A keyword comment becomes a lead and gets one private reply.
4. `rate_limit_once` produces 429 and then `SENT/200` through n8n retry policy.
5. `always_500` produces three mock attempts, `FAILED/500`, and a sanitized error row.
6. Content moves `DRAFT → APPROVED → PUBLISHED` with an external publication ID.
7. Daily analytics upserts today's report.
8. An intentionally invalid analytics date reaches the central error handler.

The suite always restores mock failure mode to `normal`. Test business rows are retained as portfolio evidence and have an `accept-*` external ID.

## Manual demo

`make demo` sends the stable DM and comment fixtures and prints a summary. Use unique fixture IDs or reset only the demo database if you want to show first-delivery behavior again.

## Verified deployment result

The deployed acceptance run confirmed fresh DM/comment `COMPLETED`, outbound `SENT/200`, one 429 followed by 200, three terminal 500 attempts followed by `FAILED/500`, published content, and a stored Markdown daily report.
