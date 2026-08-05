# Architecture

## Portable topology

```mermaid
flowchart TB
    Internet["HTTPS webhooks / operator"] --> Caddy["Caddy · TLS and security headers"]
    Caddy --> N8N["n8n · standard nodes only"]

    subgraph Backend["Internal Docker network · no host ports"]
      N8N --> PG[("PostgreSQL 16")]
      N8N --> Mock["Meta simulator · authenticated"]
      Mock --> N8N
    end

    N8N --> Egress["Optional controlled egress"]
    Egress --> APIs["Meta / Telegram / AI providers"]
```

The standalone Compose file deploys Caddy, n8n, PostgreSQL, and the deterministic mock API. Only Caddy publishes host ports. A production environment may place the n8n network namespace behind a dedicated egress gateway; this changes routing without changing workflow JSON.

## Core decisions

- **Transactional idempotency:** each external event ID is claimed in PostgreSQL before an outbound side effect. The same transaction writes the event, contact, lead, and message state.
- **Durable outbound ledger:** every intended call receives a stable key and moves through `PENDING`, `SENT`, `FAILED`, or `SKIPPED`.
- **No Code-node dependency:** workflows use Webhook, IF, Set, PostgreSQL, HTTP Request, Schedule, and Error Trigger nodes. Classification and analytics are reviewed, parameterized SQL.
- **Deterministic provider simulation:** mock responses and publication metrics are stable for a given identity, while controlled failure modes exercise retry branches.
- **Mock/live parity:** endpoint selection changes through environment configuration; workflow topology and database invariants stay the same.
- **Failure containment:** bounded retries handle transient errors. Terminal failures update business state and unexpected exceptions enter the central error workflow.
- **Portable source:** fixed workflow and credential IDs make CLI imports reproducible across fresh n8n projects.

## Inbound DM sequence

```mermaid
sequenceDiagram
    participant Meta as Meta or simulator
    participant N8N as n8n workflow 01
    participant DB as PostgreSQL
    participant Out as Outbound API

    Meta->>N8N: Authenticated webhook with external event ID
    N8N->>DB: Process event and claim idempotency key
    alt Duplicate event
        DB-->>N8N: duplicate=true
        N8N-->>Meta: Accepted, no side effect
    else First delivery
        DB-->>N8N: intent, score, reply, correlation ID
        N8N->>Out: Stable idempotency key + reply
        alt Success or recovered 429
            Out-->>N8N: 2xx
            N8N->>DB: Mark outbound and event complete
        else Terminal provider failure
            Out-->>N8N: 5xx
            N8N->>DB: Mark failed and store sanitized error
        end
    end
```

The relational model and invariants are documented in [DATA_MODEL.md](DATA_MODEL.md).
