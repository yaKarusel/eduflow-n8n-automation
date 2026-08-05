BEGIN;

CREATE OR REPLACE FUNCTION eduflow_process_dm(
  p_event_id TEXT, p_user_id TEXT, p_username TEXT, p_text TEXT,
  p_event_time TIMESTAMPTZ, p_account_id TEXT, p_intent TEXT,
  p_score INTEGER, p_status TEXT, p_reply TEXT, p_correlation_id TEXT,
  p_payload JSONB
) RETURNS TABLE(processed BOOLEAN, contact_id BIGINT, lead_id BIGINT, reply_text TEXT, lead_status TEXT, score INTEGER)
LANGUAGE plpgsql AS $$
DECLARE v_contact BIGINT; v_lead BIGINT; v_rows INTEGER;
BEGIN
  INSERT INTO idempotency_keys(key, scope, correlation_id)
  VALUES ('dm:' || p_event_id, 'instagram_dm', p_correlation_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, NULL::TEXT, 'DUPLICATE'::TEXT, p_score;
    RETURN;
  END IF;

  INSERT INTO workflow_events(external_event_id,event_type,source,status,correlation_id,payload)
  VALUES (p_event_id,'instagram_dm','instagram','PROCESSING',p_correlation_id,p_payload);

  INSERT INTO contacts(source,external_user_id,username,instagram_account_id,first_seen_at,last_seen_at)
  VALUES ('instagram_dm',p_user_id,NULLIF(p_username,''),NULLIF(p_account_id,''),p_event_time,p_event_time)
  ON CONFLICT (source,external_user_id) DO UPDATE SET
    username=COALESCE(EXCLUDED.username,contacts.username),
    instagram_account_id=COALESCE(EXCLUDED.instagram_account_id,contacts.instagram_account_id),
    last_seen_at=GREATEST(contacts.last_seen_at,EXCLUDED.last_seen_at)
  RETURNING id INTO v_contact;

  INSERT INTO leads(contact_id,source,intent,score,status,correlation_id)
  VALUES(v_contact,'instagram_dm',p_intent,p_score,p_status,p_correlation_id)
  ON CONFLICT ON CONSTRAINT leads_contact_id_source_key DO UPDATE SET
    intent=EXCLUDED.intent, score=GREATEST(leads.score,EXCLUDED.score),
    status=CASE WHEN leads.status IN ('ENROLLED','MANAGER_ASSIGNED') THEN leads.status ELSE EXCLUDED.status END,
    correlation_id=EXCLUDED.correlation_id
  RETURNING id INTO v_lead;

  INSERT INTO messages(contact_id,lead_id,external_event_id,direction,channel,body,intent,status,correlation_id,processed_at)
  VALUES(v_contact,v_lead,p_event_id,'inbound','instagram_dm',p_text,p_intent,'PROCESSED',p_correlation_id,now());

  INSERT INTO outbound_requests(idempotency_key,request_type,target_external_id,status,correlation_id,sanitized_request)
  VALUES('dm-reply:'||p_event_id,'dm_reply',p_user_id,'PENDING',p_correlation_id,jsonb_build_object('recipient_id',p_user_id,'text_length',length(p_reply)))
  ON CONFLICT DO NOTHING;

  UPDATE workflow_events SET status='READY_TO_REPLY' WHERE external_event_id=p_event_id;
  RETURN QUERY SELECT true,v_contact,v_lead,p_reply,p_status,p_score;
END;
$$;

CREATE OR REPLACE FUNCTION eduflow_process_comment(
  p_comment_id TEXT, p_media_id TEXT, p_user_id TEXT, p_username TEXT,
  p_text TEXT, p_keyword TEXT, p_campaign TEXT, p_reply TEXT,
  p_hot BOOLEAN, p_correlation_id TEXT, p_payload JSONB
) RETURNS TABLE(processed BOOLEAN, actionable BOOLEAN, contact_id BIGINT, lead_id BIGINT, reply_text TEXT)
LANGUAGE plpgsql AS $$
DECLARE v_contact BIGINT; v_lead BIGINT; v_rows INTEGER; v_actionable BOOLEAN := COALESCE(p_keyword,'') <> '';
BEGIN
  INSERT INTO idempotency_keys(key,scope,correlation_id) VALUES('comment:'||p_comment_id,'instagram_comment',p_correlation_id) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN QUERY SELECT false,false,NULL::BIGINT,NULL::BIGINT,NULL::TEXT; RETURN; END IF;

  INSERT INTO workflow_events(external_event_id,event_type,source,status,correlation_id,payload)
  VALUES(p_comment_id,'instagram_comment','instagram',CASE WHEN v_actionable THEN 'PROCESSING' ELSE 'IGNORED' END,p_correlation_id,p_payload);

  IF v_actionable THEN
    INSERT INTO contacts(source,external_user_id,username,last_seen_at)
    VALUES('instagram_comment',p_user_id,NULLIF(p_username,''),now())
    ON CONFLICT(source,external_user_id) DO UPDATE SET username=COALESCE(EXCLUDED.username,contacts.username),last_seen_at=now()
    RETURNING id INTO v_contact;
    INSERT INTO leads(contact_id,source,campaign,intent,score,status,correlation_id)
    VALUES(v_contact,'instagram_comment',p_campaign,'comment_interest',CASE WHEN p_hot THEN 60 ELSE 35 END,CASE WHEN p_hot THEN 'HOT' ELSE 'WARM' END,p_correlation_id)
    ON CONFLICT ON CONSTRAINT leads_contact_id_source_key DO UPDATE SET campaign=EXCLUDED.campaign,score=GREATEST(leads.score,EXCLUDED.score),status=EXCLUDED.status,correlation_id=EXCLUDED.correlation_id
    RETURNING id INTO v_lead;
  END IF;

  INSERT INTO comments(contact_id,lead_id,external_comment_id,external_media_id,external_user_id,username,body,matched_keyword,campaign,processing_status,correlation_id)
  VALUES(v_contact,v_lead,p_comment_id,p_media_id,p_user_id,NULLIF(p_username,''),p_text,NULLIF(p_keyword,''),p_campaign,CASE WHEN v_actionable THEN 'READY_TO_REPLY' ELSE 'IGNORED' END,p_correlation_id);

  IF v_actionable THEN
    INSERT INTO outbound_requests(idempotency_key,request_type,target_external_id,status,correlation_id,sanitized_request)
    VALUES('comment-reply:'||p_comment_id,'private_reply',p_comment_id,'PENDING',p_correlation_id,jsonb_build_object('comment_id',p_comment_id,'text_length',length(p_reply))) ON CONFLICT DO NOTHING;
  END IF;
  RETURN QUERY SELECT true,v_actionable,v_contact,v_lead,CASE WHEN v_actionable THEN p_reply ELSE NULL END;
END;
$$;

CREATE OR REPLACE FUNCTION eduflow_record_outbound(
  p_key TEXT, p_status TEXT, p_http_status INTEGER, p_request_id TEXT,
  p_response JSONB, p_body TEXT DEFAULT NULL, p_external_message_id TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_target TEXT; v_corr TEXT; v_type TEXT;
BEGIN
  UPDATE outbound_requests SET status=p_status,attempts=attempts+1,last_http_status=p_http_status,request_id=p_request_id,sanitized_response=p_response
  WHERE idempotency_key=p_key RETURNING target_external_id,correlation_id,request_type INTO v_target,v_corr,v_type;
  IF p_status='SENT' AND p_body IS NOT NULL AND v_type='dm_reply' THEN
    INSERT INTO messages(external_message_id,direction,channel,body,status,correlation_id,request_id,processed_at)
    VALUES(p_external_message_id,'outbound','instagram_dm',p_body,'SENT',v_corr,p_request_id,now()) ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION eduflow_create_content(
  p_public_id TEXT,p_title TEXT,p_type TEXT,p_caption TEXT,p_media_url TEXT,
  p_scheduled_at TIMESTAMPTZ,p_campaign TEXT,p_created_by TEXT,p_correlation_id TEXT
) RETURNS TABLE(processed BOOLEAN,content_id BIGINT,public_id TEXT,status TEXT)
LANGUAGE plpgsql AS $$
DECLARE v_id BIGINT; v_rows INTEGER;
BEGIN
  INSERT INTO idempotency_keys(key,scope,correlation_id) VALUES('content:'||p_public_id,'content_create',p_correlation_id) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN QUERY SELECT false,c.id,c.public_id,c.status FROM content_items c WHERE c.public_id=p_public_id; RETURN; END IF;
  INSERT INTO content_items(public_id,title,content_type,caption,media_url,scheduled_at,campaign,created_by,status,correlation_id)
  VALUES(p_public_id,p_title,p_type,p_caption,p_media_url,p_scheduled_at,p_campaign,p_created_by,'DRAFT',p_correlation_id) RETURNING id INTO v_id;
  RETURN QUERY SELECT true,v_id,p_public_id,'DRAFT'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION eduflow_decide_content(p_public_id TEXT,p_decision TEXT,p_reason TEXT)
RETURNS TABLE(changed BOOLEAN,content_id BIGINT,public_id TEXT,status TEXT,title TEXT,caption TEXT,media_url TEXT,content_type TEXT,scheduled_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
DECLARE v_changed_rows INTEGER;
BEGIN
  UPDATE content_items SET
    status=CASE WHEN p_decision='approve' THEN 'APPROVED' ELSE 'REJECTED' END,
    approved_at=CASE WHEN p_decision='approve' THEN now() ELSE approved_at END,
    rejection_reason=CASE WHEN p_decision='reject' THEN NULLIF(p_reason,'') ELSE NULL END
  WHERE content_items.public_id=p_public_id AND content_items.status='DRAFT';
  GET DIAGNOSTICS v_changed_rows = ROW_COUNT;
  RETURN QUERY SELECT (v_changed_rows > 0),c.id,c.public_id,c.status,c.title,c.caption,c.media_url,c.content_type,c.scheduled_at FROM content_items c WHERE c.public_id=p_public_id;
END;
$$;

CREATE OR REPLACE FUNCTION eduflow_record_publication(p_public_id TEXT,p_external_id TEXT,p_request_id TEXT,p_response JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_id BIGINT;
BEGIN
  UPDATE content_items SET status='PUBLISHED',published_at=now() WHERE public_id=p_public_id AND status IN ('APPROVED','PUBLISHING') RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN; END IF;
  INSERT INTO publications(content_item_id,external_publication_id,request_id,raw_response) VALUES(v_id,p_external_id,p_request_id,p_response) ON CONFLICT(content_item_id) DO NOTHING;
END;
$$;

COMMIT;
