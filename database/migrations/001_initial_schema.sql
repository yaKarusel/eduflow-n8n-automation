BEGIN;

CREATE TABLE IF NOT EXISTS contacts (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('instagram_dm', 'instagram_comment', 'seed')),
  external_user_id TEXT NOT NULL,
  username TEXT,
  display_name TEXT,
  instagram_account_id TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, external_user_id)
);

CREATE TABLE IF NOT EXISTS leads (
  id BIGSERIAL PRIMARY KEY,
  contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  campaign TEXT,
  intent TEXT NOT NULL DEFAULT 'unknown',
  score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 1000),
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','QUALIFYING','WARM','HOT','MANAGER_ASSIGNED','ENROLLED','LOST')),
  correlation_id TEXT,
  manager_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contact_id, source)
);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  contact_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
  lead_id BIGINT REFERENCES leads(id) ON DELETE SET NULL,
  external_event_id TEXT,
  external_message_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  channel TEXT NOT NULL DEFAULT 'instagram_dm',
  body TEXT NOT NULL,
  intent TEXT,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  correlation_id TEXT,
  request_id TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS messages_external_event_unique
  ON messages(external_event_id) WHERE external_event_id IS NOT NULL AND direction = 'inbound';
CREATE UNIQUE INDEX IF NOT EXISTS messages_external_message_unique
  ON messages(external_message_id) WHERE external_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS comments (
  id BIGSERIAL PRIMARY KEY,
  contact_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
  lead_id BIGINT REFERENCES leads(id) ON DELETE SET NULL,
  external_comment_id TEXT NOT NULL UNIQUE,
  external_media_id TEXT,
  external_user_id TEXT,
  username TEXT,
  body TEXT NOT NULL,
  matched_keyword TEXT,
  campaign TEXT,
  processing_status TEXT NOT NULL DEFAULT 'RECEIVED',
  reply_sent_at TIMESTAMPTZ,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_items (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image','carousel','reels','story')),
  caption TEXT NOT NULL,
  media_url TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ,
  campaign TEXT,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','REJECTED','PUBLISHING','PUBLISHED','FAILED')),
  rejection_reason TEXT,
  correlation_id TEXT,
  approved_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS publications (
  id BIGSERIAL PRIMARY KEY,
  content_item_id BIGINT NOT NULL UNIQUE REFERENCES content_items(id) ON DELETE CASCADE,
  external_publication_id TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'instagram',
  status TEXT NOT NULL DEFAULT 'PUBLISHED',
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_id TEXT,
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS publication_metrics (
  id BIGSERIAL PRIMARY KEY,
  publication_id BIGINT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  reach INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  saves INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  raw_metrics JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (publication_id, metric_date)
);

CREATE TABLE IF NOT EXISTS workflow_events (
  id BIGSERIAL PRIMARY KEY,
  external_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  correlation_id TEXT NOT NULL,
  processing_ms INTEGER,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  correlation_id TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS error_logs (
  id BIGSERIAL PRIMARY KEY,
  workflow_name TEXT NOT NULL,
  execution_id TEXT,
  node_name TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','error','critical')),
  error_message TEXT NOT NULL,
  http_status INTEGER,
  source TEXT,
  correlation_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  sanitized_details JSONB,
  notification_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS error_logs_fingerprint_created_idx ON error_logs(fingerprint, created_at DESC);

CREATE TABLE IF NOT EXISTS daily_reports (
  id BIGSERIAL PRIMARY KEY,
  report_date DATE NOT NULL UNIQUE,
  markdown TEXT NOT NULL,
  metrics JSONB NOT NULL,
  telegram_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbound_requests (
  id BIGSERIAL PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_type TEXT NOT NULL,
  target_external_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RETRYING','SENT','FAILED','SKIPPED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_http_status INTEGER,
  request_id TEXT,
  correlation_id TEXT,
  sanitized_request JSONB,
  sanitized_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contacts_last_seen_idx ON contacts(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS leads_status_created_idx ON leads(status, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_created_idx ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS comments_created_idx ON comments(created_at DESC);
CREATE INDEX IF NOT EXISTS content_status_schedule_idx ON content_items(status, scheduled_at);
CREATE INDEX IF NOT EXISTS workflow_events_type_created_idx ON workflow_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS outbound_status_created_idx ON outbound_requests(status, created_at DESC);

CREATE OR REPLACE FUNCTION eduflow_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['contacts','leads','messages','comments','content_items','publications','publication_metrics','workflow_events','daily_reports','outbound_requests']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS touch_updated_at ON %I', t);
    EXECUTE format('CREATE TRIGGER touch_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION eduflow_touch_updated_at()', t);
  END LOOP;
END;
$$;

CREATE OR REPLACE VIEW v_daily_funnel AS
SELECT
  d::date AS report_date,
  (SELECT count(*) FROM contacts c WHERE c.created_at >= d AND c.created_at < d + interval '1 day') AS new_contacts,
  (SELECT count(*) FROM leads l WHERE l.created_at >= d AND l.created_at < d + interval '1 day') AS new_leads,
  (SELECT count(*) FROM leads l WHERE l.status IN ('HOT','MANAGER_ASSIGNED') AND l.created_at >= d AND l.created_at < d + interval '1 day') AS hot_leads,
  (SELECT count(*) FROM messages m WHERE m.direction='inbound' AND m.created_at >= d AND m.created_at < d + interval '1 day') AS direct_messages,
  (SELECT count(*) FROM comments c WHERE c.created_at >= d AND c.created_at < d + interval '1 day') AS comments,
  (SELECT count(*) FROM outbound_requests o WHERE o.status='SENT' AND o.created_at >= d AND o.created_at < d + interval '1 day') AS automatic_replies,
  (SELECT count(*) FROM leads l WHERE l.status='MANAGER_ASSIGNED' AND l.updated_at >= d AND l.updated_at < d + interval '1 day') AS manager_handoffs,
  (SELECT count(*) FROM publications p WHERE p.published_at >= d AND p.published_at < d + interval '1 day') AS publications,
  (SELECT count(*) FROM error_logs e WHERE e.created_at >= d AND e.created_at < d + interval '1 day') AS errors,
  COALESCE((SELECT round(avg(w.processing_ms)::numeric, 2) FROM workflow_events w WHERE w.created_at >= d AND w.created_at < d + interval '1 day'), 0) AS avg_processing_ms
FROM generate_series(current_date - interval '90 days', current_date, interval '1 day') d;

COMMIT;
