BEGIN;

CREATE OR REPLACE FUNCTION eduflow_daily_metrics(p_date DATE)
RETURNS TABLE(
  report_date DATE,new_contacts BIGINT,new_leads BIGINT,hot_leads BIGINT,
  direct_messages BIGINT,comments BIGINT,automatic_replies BIGINT,
  manager_handoffs BIGINT,publications BIGINT,errors BIGINT,
  avg_processing_ms NUMERIC,comment_conversion NUMERIC,dm_conversion NUMERIC,
  top_publication TEXT
) LANGUAGE sql STABLE AS $$
WITH bounds AS (SELECT p_date::timestamptz s,(p_date+1)::timestamptz e),
base AS (
 SELECT
  (SELECT count(*) FROM contacts,bounds WHERE created_at>=s AND created_at<e) nc,
  (SELECT count(*) FROM leads,bounds WHERE created_at>=s AND created_at<e) nl,
  (SELECT count(*) FROM leads,bounds WHERE status IN ('HOT','MANAGER_ASSIGNED') AND created_at>=s AND created_at<e) hl,
  (SELECT count(*) FROM messages,bounds WHERE direction='inbound' AND created_at>=s AND created_at<e) dm,
  (SELECT count(*) FROM comments,bounds WHERE created_at>=s AND created_at<e) cm,
  (SELECT count(*) FROM outbound_requests,bounds WHERE status='SENT' AND created_at>=s AND created_at<e) ar,
  (SELECT count(*) FROM leads,bounds WHERE status='MANAGER_ASSIGNED' AND updated_at>=s AND updated_at<e) mh,
  (SELECT count(*) FROM publications,bounds WHERE published_at>=s AND published_at<e) pb,
  (SELECT count(*) FROM error_logs,bounds WHERE created_at>=s AND created_at<e) er,
  COALESCE((SELECT round(avg(processing_ms)::numeric,2) FROM workflow_events,bounds WHERE created_at>=s AND created_at<e),0) ap,
  (SELECT p.external_publication_id FROM publications p LEFT JOIN publication_metrics m ON m.publication_id=p.id WHERE m.metric_date=p_date ORDER BY (m.saves+m.shares+m.comments+m.likes) DESC NULLS LAST LIMIT 1) tp,
  (SELECT count(*) FROM comments,bounds WHERE lead_id IS NOT NULL AND created_at>=s AND created_at<e) cml,
  (SELECT count(*) FROM leads l JOIN contacts c ON c.id=l.contact_id,bounds WHERE l.source='instagram_dm' AND l.created_at>=s AND l.created_at<e) dml
)
SELECT p_date,nc,nl,hl,dm,cm,ar,mh,pb,er,ap,
 CASE WHEN cm=0 THEN 0 ELSE round(cml::numeric*100/cm,2) END,
 CASE WHEN dm=0 THEN 0 ELSE round(dml::numeric*100/dm,2) END,
 tp FROM base;
$$;

COMMIT;
