BEGIN;

INSERT INTO contacts(source,external_user_id,username,display_name,first_seen_at,last_seen_at) VALUES
 ('seed','seed-u1','anna_code','Anna',now()-interval '6 days',now()-interval '1 day'),
 ('seed','seed-u2','max_python','Max',now()-interval '5 days',now()-interval '2 days'),
 ('seed','seed-u3','lena.study','Elena',now()-interval '4 days',now()-interval '1 day'),
 ('seed','seed-u4','pavel_data','Pavel',now()-interval '3 days',now()-interval '1 day'),
 ('seed','seed-u5','maria.learn','Maria',now()-interval '2 days',now())
ON CONFLICT(source,external_user_id) DO NOTHING;

INSERT INTO leads(contact_id,source,campaign,intent,score,status,correlation_id)
SELECT id,'seed','python-summer',CASE external_user_id WHEN 'seed-u1' THEN 'price' WHEN 'seed-u2' THEN 'consultation' ELSE 'course_program' END,
 CASE external_user_id WHEN 'seed-u1' THEN 55 WHEN 'seed-u2' THEN 70 ELSE 35 END,
 CASE external_user_id WHEN 'seed-u1' THEN 'HOT' WHEN 'seed-u2' THEN 'MANAGER_ASSIGNED' ELSE 'WARM' END,
 'seed-'||external_user_id FROM contacts WHERE source='seed'
ON CONFLICT(contact_id,source) DO NOTHING;

INSERT INTO messages(contact_id,lead_id,external_event_id,direction,channel,body,intent,status,correlation_id,processed_at)
SELECT c.id,l.id,'seed-msg-'||c.external_user_id,'inbound','instagram_dm','Хочу узнать программу и цену курса',l.intent,'PROCESSED',l.correlation_id,now()-interval '1 day'
FROM contacts c JOIN leads l ON l.contact_id=c.id WHERE c.source='seed' ON CONFLICT DO NOTHING;

INSERT INTO comments(contact_id,lead_id,external_comment_id,external_media_id,external_user_id,username,body,matched_keyword,campaign,processing_status,correlation_id)
SELECT c.id,l.id,'seed-comment-'||c.external_user_id,'seed-media-1',c.external_user_id,c.username,'Хочу гайд по Python','гайд','python-summer','REPLIED',l.correlation_id
FROM contacts c JOIN leads l ON l.contact_id=c.id WHERE c.source='seed' LIMIT 3 ON CONFLICT DO NOTHING;

INSERT INTO content_items(public_id,title,content_type,caption,media_url,scheduled_at,campaign,created_by,status,correlation_id,published_at) VALUES
 ('seed-content-1','Python: первый шаг','reels','Три шага для старта','https://example.com/video.mp4',now()-interval '2 days','python-summer','seed','PUBLISHED','seed-content-corr-1',now()-interval '2 days'),
 ('seed-content-2','SQL без страха','image','Короткий SQL-гайд','https://example.com/sql.png',now()-interval '1 day','data-summer','seed','PUBLISHED','seed-content-corr-2',now()-interval '1 day')
ON CONFLICT(public_id) DO NOTHING;

INSERT INTO publications(content_item_id,external_publication_id,status,published_at)
SELECT id,'seed-publication-'||id,'PUBLISHED',published_at FROM content_items WHERE public_id LIKE 'seed-content-%' ON CONFLICT(content_item_id) DO NOTHING;

INSERT INTO publication_metrics(publication_id,metric_date,impressions,reach,likes,comments,saves,shares,raw_metrics)
SELECT id,current_date-1,1200,950,110,14,33,12,'{"source":"seed"}'::jsonb FROM publications WHERE external_publication_id LIKE 'seed-publication-%'
ON CONFLICT(publication_id,metric_date) DO NOTHING;

INSERT INTO error_logs(workflow_name,severity,error_message,source,correlation_id,fingerprint,sanitized_details)
SELECT 'EduFlow Seed','warning','Synthetic recoverable API error','seed','seed-error-correlation','seed-error-fingerprint','{"synthetic":true}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM error_logs WHERE fingerprint='seed-error-fingerprint');

COMMIT;
