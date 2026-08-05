import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outDir = path.resolve('workflows');
const credential = { postgres: { id: 'EFPOSTGRES000001', name: 'EduFlow PostgreSQL' } };
const errorWorkflow = 'EFERROR000000001';

const ids = {
  dm: 'EFDMLEAD00000001',
  comment: 'EFCOMMENT0000001',
  content: 'EFCONTENT0000001',
  analytics: 'EFANALYTICS00001',
  error: errorWorkflow,
};

const baseSettings = {
  executionOrder: 'v1',
  saveDataErrorExecution: 'all',
  saveDataSuccessExecution: 'none',
  saveManualExecutions: true,
  callerPolicy: 'workflowsFromSameOwner',
  errorWorkflow,
};

function node(name, type, position, parameters = {}, extra = {}) {
  return {
    parameters,
    id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Math.abs(position[0])}-${Math.abs(position[1])}`,
    name,
    type,
    typeVersion: type === 'n8n-nodes-base.postgres' ? 2.6 : type === 'n8n-nodes-base.httpRequest' ? 4.2 : type === 'n8n-nodes-base.webhook' ? 2.1 : type === 'n8n-nodes-base.if' ? 2.2 : type === 'n8n-nodes-base.respondToWebhook' ? 1.4 : 2,
    position,
    ...extra,
  };
}

function note(name, position, content, width = 520, height = 260) {
  return node(name, 'n8n-nodes-base.stickyNote', position, { content, width, height }, { typeVersion: 1 });
}

function webhook(name, position, pathName, responseMode = 'lastNode') {
  return node(name, 'n8n-nodes-base.webhook', position, {
    httpMethod: 'POST', path: pathName, responseMode, options: {},
  }, { webhookId: `webhook-${pathName.replaceAll('/', '-')}` });
}

function pg(name, position, query, queryReplacement) {
  return node(name, 'n8n-nodes-base.postgres', position, {
    operation: 'executeQuery', query,
    options: queryReplacement ? { queryReplacement } : {},
  }, { credentials: credential });
}

function code(name, position, jsCode) {
  return node(name, 'n8n-nodes-base.code', position, { jsCode });
}

function boolIf(name, position, leftValue) {
  return node(name, 'n8n-nodes-base.if', position, {
    conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ id: `${name}-condition`, leftValue, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
    options: {},
  });
}

function http(name, position, method, url, body, { retries = true, onError = true, headers = true } = {}) {
  const parameters = {
    method, url,
    sendHeaders: headers,
    headerParameters: { parameters: [
      { name: 'x-api-token', value: '={{ $env.META_MODE === "mock" ? $env.MOCK_API_TOKEN : "" }}' },
      { name: 'Authorization', value: '={{ $env.META_MODE === "live" ? "Bearer " + $env.META_ACCESS_TOKEN : "" }}' },
      { name: 'x-request-id', value: '={{ $json.correlation_id || $execution.id }}' },
    ] },
    options: { timeout: 20000 },
  };
  if (body !== undefined) {
    parameters.sendBody = true;
    parameters.contentType = 'raw';
    parameters.rawContentType = 'application/json';
    parameters.body = body;
  }
  return node(name, 'n8n-nodes-base.httpRequest', position, parameters, {
    ...(retries ? { retryOnFail: true, maxTries: 3, waitBetweenTries: 1000 } : {}),
    ...(onError ? { onError: 'continueErrorOutput' } : {}),
  });
}

function workflow(id, name, nodes, connections, settings = baseSettings) {
  return { id, name, active: false, nodes, connections, settings, pinData: {}, meta: { templateCredsSetupCompleted: true }, tags: [] };
}

const normalizeDm = String.raw`
const envelope = $json;
const headers = envelope.headers ?? {};
const body = envelope.body ?? envelope;
const mock = ($env.META_MODE || 'mock') === 'mock';
if (mock && headers['x-eduflow-token'] !== $env.MOCK_API_TOKEN) throw new Error('Unauthorized EduFlow mock event');
const metaEvent = body.entry?.[0]?.messaging?.[0];
const eventId = String(body.event_id ?? metaEvent?.message?.mid ?? '');
const userId = String(body.user_id ?? metaEvent?.sender?.id ?? '');
const text = String(body.text ?? metaEvent?.message?.text ?? '').trim().slice(0, 4000);
if (!eventId || !userId || !text) throw new Error('Invalid Instagram DM payload');
const lower = text.toLocaleLowerCase('ru-RU');
const has = (...words) => words.some((word) => lower.includes(word));
let intent = 'general';
let score = 15;
let reply = 'Спасибо за сообщение! Подскажите, какая программа и цель обучения вам интересны?';
if (has('сколько', 'цена', 'стоим', 'рассроч', 'оплат')) {
  intent = 'pricing'; score = has('хочу', 'купить', 'запис') ? 75 : 55;
  reply = 'Спасибо за интерес к EduFlow! Я отправлю актуальную программу и варианты оплаты. Напишите, пожалуйста, ваш уровень и удобное время для консультации.';
} else if (has('консультац', 'позвон', 'связаться', 'менеджер')) {
  intent = 'consultation'; score = 70;
  reply = 'Отлично, передаю запрос менеджеру EduFlow. Напишите удобное время и часовой пояс — свяжемся с вами.';
} else if (has('курс', 'обуч', 'python', 'программ')) {
  intent = 'course_interest'; score = 40;
  reply = 'Расскажу подробнее! Какой у вас текущий уровень и какую задачу хотите решить обучением?';
}
const threshold = Number($env.HOT_LEAD_THRESHOLD || 50);
return [{ json: {
  event_id: eventId, user_id: userId, username: String(body.username ?? '').slice(0, 200), text,
  event_time: body.timestamp ?? new Date().toISOString(), account_id: String(body.instagram_account_id ?? ''),
  intent, score, lead_status: score >= threshold ? 'HOT' : score >= 30 ? 'WARM' : 'QUALIFYING',
  reply_text: reply, correlation_id: String(headers['x-request-id'] ?? 'dm-' + eventId), raw_payload: body,
} }];`;

const dmStoreQuery = `SELECT r.*, $1::text AS event_id, $2::text AS user_id, $11::text AS correlation_id
FROM eduflow_process_dm($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) r;`;

const dmNodes = [
  note('DM Architecture', [-820, -380], '## 01 — Instagram DM → Lead\n\nValidates the ingress token, normalizes mock/Meta payloads, classifies intent, scores the lead, reserves an idempotency key in PostgreSQL, then sends exactly one reply. External calls retry on 429/5xx and log terminal failures.\n\nSecrets stay in environment variables; execution payload persistence is disabled for successful production runs.'),
  webhook('Instagram DM Webhook', [-760, 0], 'eduflow/instagram/dm', 'onReceived'),
  code('Normalize and Qualify DM', [-520, 0], normalizeDm),
  pg('Store DM Transaction', [-260, 0], dmStoreQuery, '={{ [$json.event_id,$json.user_id,$json.username,$json.text,$json.event_time,$json.account_id,$json.intent,$json.score,$json.lead_status,$json.reply_text,$json.correlation_id,JSON.stringify($json.raw_payload)] }}'),
  boolIf('New DM', [-20, 0], '={{ $json.processed }}'),
  http('Send DM Reply', [240, -100], 'POST', '={{ $env.META_MODE === "mock" ? $env.EDUFLOW_MOCK_URL + "/v1/messages/send" : "https://graph.facebook.com/" + $env.META_API_VERSION + "/" + $env.META_IG_ACCOUNT_ID + "/messages" }}', '={{ JSON.stringify($env.META_MODE === "mock" ? {recipient_id:$json.user_id,text:$json.reply_text,idempotency_key:"dm-reply:"+$json.event_id} : {recipient:{id:$json.user_id},message:{text:$json.reply_text},messaging_type:"RESPONSE"}) }}'),
  pg('Record DM Success', [510, -180], `SELECT eduflow_record_outbound($1,'SENT',$2,$3,$4::jsonb,$5,$6);
UPDATE workflow_events SET status='COMPLETED',processing_ms=(extract(epoch from (now()-created_at))*1000)::int WHERE external_event_id=$7;
SELECT true AS ok,$7::text AS event_id,$8::int AS score,$9::text AS lead_status;`, '={{ ["dm-reply:"+$("Store DM Transaction").item.json.event_id,200,$json.request_id||"",JSON.stringify($json),$("Store DM Transaction").item.json.reply_text,$json.message_id||$json.id||"",$("Store DM Transaction").item.json.event_id,$("Store DM Transaction").item.json.score,$("Store DM Transaction").item.json.lead_status] }}'),
  boolIf('Notify Manager', [760, -180], '={{ Number($json.score) >= Number($env.HOT_LEAD_THRESHOLD || 50) && $env.TELEGRAM_ENABLED === "true" }}'),
  http('Telegram Hot Lead', [1010, -280], 'POST', '={{ "https://api.telegram.org/bot" + $env.TELEGRAM_BOT_TOKEN + "/sendMessage" }}', '={{ JSON.stringify({chat_id:$env.TELEGRAM_CHAT_ID,text:"🔥 Горячий лид EduFlow из Instagram DM\nEvent: "+$json.event_id+"\nScore: "+$json.score}) }}', { retries: true, onError: true, headers: false }),
  pg('Record DM Failure', [510, 60], `SELECT eduflow_record_outbound($1,'FAILED',$2,$3,$4::jsonb);
UPDATE workflow_events SET status='FAILED',processing_ms=(extract(epoch from (now()-created_at))*1000)::int WHERE external_event_id=$5;
INSERT INTO error_logs(workflow_name,execution_id,node_name,severity,error_message,http_status,source,correlation_id,fingerprint,sanitized_details)
VALUES('01 EduFlow - DM Lead Qualification',$6,'Send DM Reply','error',$7,$2,'instagram_dm',$8,'dm-send:'||$2,jsonb_build_object('event_id',$5,'http_status',$2));
SELECT false AS ok,'OUTBOUND_FAILED' AS status,$5::text AS event_id;`, '={{ ["dm-reply:"+$("Store DM Transaction").item.json.event_id,Number($json.httpCode||$json.statusCode||500),$json.request_id||"",JSON.stringify($json),$("Store DM Transaction").item.json.event_id,$execution.id,String($json.message||$json.error||"Outbound request failed"),$("Store DM Transaction").item.json.correlation_id] }}'),
];

const dmConnections = {
  'Instagram DM Webhook': { main: [[{ node: 'Normalize and Qualify DM', type: 'main', index: 0 }]] },
  'Normalize and Qualify DM': { main: [[{ node: 'Store DM Transaction', type: 'main', index: 0 }]] },
  'Store DM Transaction': { main: [[{ node: 'New DM', type: 'main', index: 0 }]] },
  'New DM': { main: [[{ node: 'Send DM Reply', type: 'main', index: 0 }], []] },
  'Send DM Reply': { main: [[{ node: 'Record DM Success', type: 'main', index: 0 }], [{ node: 'Record DM Failure', type: 'main', index: 0 }]] },
  'Record DM Success': { main: [[{ node: 'Notify Manager', type: 'main', index: 0 }]] },
  'Notify Manager': { main: [[{ node: 'Telegram Hot Lead', type: 'main', index: 0 }], []] },
};

const normalizeComment = String.raw`
const envelope = $json;
const headers = envelope.headers ?? {};
const body = envelope.body ?? envelope;
if (($env.META_MODE || 'mock') === 'mock' && headers['x-eduflow-token'] !== $env.MOCK_API_TOKEN) throw new Error('Unauthorized EduFlow mock event');
const change = body.entry?.[0]?.changes?.[0]?.value;
const commentId = String(body.comment_id ?? change?.id ?? '');
const mediaId = String(body.media_id ?? change?.media?.id ?? '');
const userId = String(body.user_id ?? change?.from?.id ?? '');
const username = String(body.username ?? change?.from?.username ?? '').slice(0, 200);
const text = String(body.text ?? change?.text ?? '').trim().slice(0, 4000);
if (!commentId || !mediaId || !userId || !text) throw new Error('Invalid Instagram comment payload');
const lower = text.toLocaleLowerCase('ru-RU');
const keywords = ['гайд','пробный','урок','курс','python','обучение','чек-лист'];
const keyword = keywords.find((word) => lower.includes(word)) ?? '';
const hot = ['хочу','купить','запис','цена','стоим'].some((word) => lower.includes(word));
const campaign = lower.includes('python') ? 'python-organic' : keyword ? 'education-organic' : 'unmatched';
const reply = keyword ? 'Спасибо за интерес! Отправляем материалы EduFlow в личные сообщения. Если нужна консультация — ответьте «хочу консультацию».' : '';
return [{json:{comment_id:commentId,media_id:mediaId,user_id:userId,username,text,keyword,campaign,reply_text:reply,hot,correlation_id:String(headers['x-request-id']??'comment-'+commentId),raw_payload:body}}];`;

const commentNodes = [
  note('Comment Architecture', [-820, -380], '## 02 — Comment → Lead\n\nDetects campaign keywords without AI, ignores unrelated comments, creates a lead transactionally, and sends one private reply. Duplicate webhook deliveries are acknowledged without repeating side effects.'),
  webhook('Instagram Comment Webhook', [-760, 0], 'eduflow/instagram/comment', 'onReceived'),
  code('Normalize Comment', [-520, 0], normalizeComment),
  pg('Store Comment Transaction', [-260, 0], `SELECT r.*,$1::text AS comment_id,$2::text AS media_id,$3::text AS user_id,$10::text AS correlation_id
FROM eduflow_process_comment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) r;`, '={{ [$json.comment_id,$json.media_id,$json.user_id,$json.username,$json.text,$json.keyword,$json.campaign,$json.reply_text,$json.hot,$json.correlation_id,JSON.stringify($json.raw_payload)] }}'),
  boolIf('Actionable New Comment', [0, 0], '={{ $json.processed && $json.actionable }}'),
  http('Send Private Reply', [260, -100], 'POST', '={{ $env.META_MODE === "mock" ? $env.EDUFLOW_MOCK_URL + "/v1/comments/private-reply" : "https://graph.facebook.com/" + $env.META_API_VERSION + "/" + $json.comment_id + "/private_replies" }}', '={{ JSON.stringify($env.META_MODE === "mock" ? {comment_id:$json.comment_id,text:$json.reply_text,idempotency_key:"comment-reply:"+$json.comment_id} : {message:$json.reply_text}) }}'),
  pg('Record Comment Success', [530, -180], `SELECT eduflow_record_outbound($1,'SENT',200,$2,$3::jsonb);
UPDATE comments SET processing_status='REPLIED',reply_sent_at=now() WHERE external_comment_id=$4;
UPDATE workflow_events SET status='COMPLETED',processing_ms=(extract(epoch from (now()-created_at))*1000)::int WHERE external_event_id=$4;
SELECT true AS ok,$4::text AS comment_id;`, '={{ ["comment-reply:"+$("Store Comment Transaction").item.json.comment_id,$json.request_id||"",JSON.stringify($json),$("Store Comment Transaction").item.json.comment_id] }}'),
  pg('Record Comment Failure', [530, 70], `SELECT eduflow_record_outbound($1,'FAILED',$2,$3,$4::jsonb);
UPDATE comments SET processing_status='FAILED' WHERE external_comment_id=$5;
UPDATE workflow_events SET status='FAILED' WHERE external_event_id=$5;
INSERT INTO error_logs(workflow_name,execution_id,node_name,severity,error_message,http_status,source,correlation_id,fingerprint,sanitized_details)
VALUES('02 EduFlow - Comment to Lead',$6,'Send Private Reply','error',$7,$2,'instagram_comment',$8,'comment-send:'||$2,jsonb_build_object('comment_id',$5));
SELECT false AS ok,'OUTBOUND_FAILED' AS status,$5::text AS comment_id;`, '={{ ["comment-reply:"+$("Store Comment Transaction").item.json.comment_id,Number($json.httpCode||$json.statusCode||500),$json.request_id||"",JSON.stringify($json),$("Store Comment Transaction").item.json.comment_id,$execution.id,String($json.message||$json.error||"Outbound request failed"),$("Store Comment Transaction").item.json.correlation_id] }}'),
];

const commentConnections = {
  'Instagram Comment Webhook': { main: [[{ node: 'Normalize Comment', type: 'main', index: 0 }]] },
  'Normalize Comment': { main: [[{ node: 'Store Comment Transaction', type: 'main', index: 0 }]] },
  'Store Comment Transaction': { main: [[{ node: 'Actionable New Comment', type: 'main', index: 0 }]] },
  'Actionable New Comment': { main: [[{ node: 'Send Private Reply', type: 'main', index: 0 }], []] },
  'Send Private Reply': { main: [[{ node: 'Record Comment Success', type: 'main', index: 0 }], [{ node: 'Record Comment Failure', type: 'main', index: 0 }]] },
};

const normalizeContent = String.raw`
const envelope=$json; const headers=envelope.headers??{}; const b=envelope.body??envelope;
if (headers['x-eduflow-token'] !== $env.MOCK_API_TOKEN) throw new Error('Unauthorized content request');
for (const key of ['title','content_type','caption','media_url','created_by']) if (!String(b[key]??'').trim()) throw new Error('Missing content field: '+key);
if (!['image','carousel','reels','story'].includes(b.content_type)) throw new Error('Unsupported content_type');
const mediaUrl=String(b.media_url); if (!/^https:\/\//i.test(mediaUrl)) throw new Error('media_url must use HTTPS');
const mediaHost=mediaUrl.slice(8).split('/')[0].split(':')[0].toLowerCase(); const allowed=String($env.ALLOWED_MEDIA_HOSTS||'example.com').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
if (!mediaHost || !allowed.some(host=>mediaHost===host || mediaHost.endsWith('.'+host))) throw new Error('media_url host is not allow-listed');
const correlation=String(headers['x-request-id']??'content-'+Date.now());
return [{json:{public_id:String(b.public_id??correlation).replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,120),title:String(b.title).slice(0,300),content_type:b.content_type,caption:String(b.caption).slice(0,2200),media_url:mediaUrl,scheduled_at:b.scheduled_at||null,campaign:String(b.campaign??''),created_by:String(b.created_by).slice(0,200),correlation_id:correlation}}];`;

const normalizeDecision = String.raw`
const envelope=$json; const headers=envelope.headers??{}; const b=envelope.body??envelope;
const supplied=String(headers['x-approval-secret']??b.secret??'');
if (!supplied || supplied!==$env.APPROVAL_SECRET) throw new Error('Unauthorized approval request');
const decision=String(b.decision??'').toLowerCase();
if (!['approve','reject'].includes(decision) || !b.public_id) throw new Error('decision and public_id are required');
return [{json:{public_id:String(b.public_id),decision,reason:String(b.reason??'').slice(0,1000),immediate:Boolean(b.immediate)}}];`;

const contentNodes = [
  note('Content Architecture', [-980, -500], '## 03 — Content approval and publishing\n\nSeparate authenticated endpoints create drafts and record approve/reject decisions. Approved due items are published immediately or by a five-minute scheduler. Media hosts are allow-listed. Mock mode is deterministic; live mode uses the current Graph API container + publish sequence and must be validated with the client Meta app.'),
  webhook('Create Content Webhook', [-940, -120], 'eduflow/content/create'),
  code('Validate Content', [-700, -120], normalizeContent),
  pg('Create Draft', [-450, -120], `SELECT * FROM eduflow_create_content($1,$2,$3,$4,$5,$6,$7,$8,$9);`, '={{ [$json.public_id,$json.title,$json.content_type,$json.caption,$json.media_url,$json.scheduled_at,$json.campaign,$json.created_by,$json.correlation_id] }}'),
  webhook('Decision Webhook', [-940, 140], 'eduflow/content/decision'),
  code('Validate Decision', [-700, 140], normalizeDecision),
  pg('Record Decision', [-450, 140], `SELECT d.*,$4::boolean AS immediate,c.correlation_id FROM eduflow_decide_content($1,$2,$3) d JOIN content_items c ON c.id=d.content_id;`, '={{ [$json.public_id,$json.decision,$json.reason,$json.immediate] }}'),
  boolIf('Publish Decision Now', [-190, 140], '={{ $json.status === "APPROVED" && ($json.immediate || !$json.scheduled_at || new Date($json.scheduled_at) <= new Date()) }}'),
  code('Return Decision Result', [70, 300], `return items;`),
  node('Due Content Schedule', 'n8n-nodes-base.scheduleTrigger', [-700, 390], { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } }, { typeVersion: 1.2 }),
  pg('Select Due Content', [-450, 390], `UPDATE content_items SET status='PUBLISHING'
WHERE id IN (SELECT id FROM content_items WHERE status='APPROVED' AND COALESCE(scheduled_at,now())<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 20)
RETURNING public_id,title,caption,media_url,content_type,scheduled_at,correlation_id;`),
  boolIf('Has Due Content', [-210, 390], '={{ Boolean($json.public_id) }}'),
  code('Prepare Publish Request', [-30, 100], `return items.map(item=>({json:{...item.json,correlation_id:item.json.correlation_id||'content-'+item.json.public_id}}));`),
  http('Create Content Container', [170, 100], 'POST', '={{ $env.META_MODE === "mock" ? $env.EDUFLOW_MOCK_URL + "/v1/content/publish" : "https://graph.facebook.com/" + $env.META_API_VERSION + "/" + $env.META_IG_ACCOUNT_ID + "/media" }}', '={{ JSON.stringify($env.META_MODE === "mock" ? {content_id:$json.public_id,caption:$json.caption,media_url:$json.media_url,content_type:$json.content_type} : Object.assign({caption:$json.caption},$json.content_type === "reels" ? {media_type:"REELS",video_url:$json.media_url} : {image_url:$json.media_url})) }}'),
  boolIf('Live Meta Mode', [350, 100], '={{ $env.META_MODE === "live" }}'),
  http('Publish Meta Container', [600, 0], 'POST', '={{ "https://graph.facebook.com/" + $env.META_API_VERSION + "/" + $env.META_IG_ACCOUNT_ID + "/media_publish" }}', '={{ JSON.stringify({creation_id:$json.id,access_token:$env.META_ACCESS_TOKEN}) }}'),
  code('Normalize Publication Result', [850, 100], `return items.map(item=>({json:{external_publication_id:String(item.json.publication_id??item.json.id??''),request_id:String(item.json.request_id??''),raw_response:item.json}}));`),
  pg('Record Publication', [1090, 100], `SELECT eduflow_record_publication($1,$2,$3,$4::jsonb); SELECT true AS ok,$1::text AS public_id,$2::text AS publication_id;`, '={{ [$("Prepare Publish Request").item.json.public_id,$json.external_publication_id,$json.request_id,JSON.stringify($json.raw_response)] }}'),
  pg('Record Publish Failure', [350, 310], `UPDATE content_items SET status='FAILED' WHERE public_id=$1;
INSERT INTO error_logs(workflow_name,execution_id,node_name,severity,error_message,http_status,source,correlation_id,fingerprint,sanitized_details)
VALUES('03 EduFlow - Content Approval Publishing',$2,'Create Content Container','error',$3,$4,'content',$5,'content-publish:'||$4,jsonb_build_object('public_id',$1));
SELECT false AS ok,'FAILED' AS status,$1::text AS public_id;`, '={{ [$("Prepare Publish Request").item.json.public_id,$execution.id,String($json.message||$json.error||"Publish failed"),Number($json.httpCode||$json.statusCode||500),$("Prepare Publish Request").item.json.correlation_id] }}'),
  node('Metrics Schedule', 'n8n-nodes-base.scheduleTrigger', [-190, 620], { rule: { interval: [{ field: 'hours', hoursInterval: 6 }] } }, { typeVersion: 1.2 }),
  pg('Select Publications for Metrics', [90, 620], `SELECT p.id AS publication_db_id,p.external_publication_id,c.public_id,c.correlation_id FROM publications p JOIN content_items c ON c.id=p.content_item_id WHERE p.published_at>=now()-interval '30 days' ORDER BY p.published_at DESC LIMIT 100;`),
  boolIf('Has Publication for Metrics', [300, 760], '={{ Boolean($json.publication_db_id) }}'),
  http('Fetch Publication Metrics', [520, 620], 'GET', '={{ $env.META_MODE === "mock" ? $env.EDUFLOW_MOCK_URL + "/v1/content/" + encodeURIComponent($json.external_publication_id) + "/metrics" : "https://graph.facebook.com/" + $env.META_API_VERSION + "/" + $json.external_publication_id + "/insights?metric=impressions,reach,likes,comments,saved,shares" }}', undefined),
  pg('Store Publication Metrics', [620, 620], `INSERT INTO publication_metrics(publication_id,metric_date,impressions,reach,likes,comments,saves,shares,raw_metrics)
VALUES($1,current_date,$2,$3,$4,$5,$6,$7,$8::jsonb)
ON CONFLICT(publication_id,metric_date) DO UPDATE SET impressions=EXCLUDED.impressions,reach=EXCLUDED.reach,likes=EXCLUDED.likes,comments=EXCLUDED.comments,saves=EXCLUDED.saves,shares=EXCLUDED.shares,raw_metrics=EXCLUDED.raw_metrics;
SELECT true AS ok,$1::bigint AS publication_db_id;`, '={{ [$("Select Publications for Metrics").item.json.publication_db_id,Number($json.impressions||0),Number($json.reach||0),Number($json.likes||0),Number($json.comments||0),Number($json.saves||0),Number($json.shares||0),JSON.stringify($json)] }}'),
];

const contentConnections = {
  'Create Content Webhook': { main: [[{ node: 'Validate Content', type: 'main', index: 0 }]] },
  'Validate Content': { main: [[{ node: 'Create Draft', type: 'main', index: 0 }]] },
  'Decision Webhook': { main: [[{ node: 'Validate Decision', type: 'main', index: 0 }]] },
  'Validate Decision': { main: [[{ node: 'Record Decision', type: 'main', index: 0 }]] },
  'Record Decision': { main: [[{ node: 'Publish Decision Now', type: 'main', index: 0 }]] },
  'Publish Decision Now': { main: [[{ node: 'Prepare Publish Request', type: 'main', index: 0 }], [{ node: 'Return Decision Result', type: 'main', index: 0 }]] },
  'Due Content Schedule': { main: [[{ node: 'Select Due Content', type: 'main', index: 0 }]] },
  'Select Due Content': { main: [[{ node: 'Has Due Content', type: 'main', index: 0 }]] },
  'Has Due Content': { main: [[{ node: 'Prepare Publish Request', type: 'main', index: 0 }], []] },
  'Prepare Publish Request': { main: [[{ node: 'Create Content Container', type: 'main', index: 0 }]] },
  'Create Content Container': { main: [[{ node: 'Live Meta Mode', type: 'main', index: 0 }], [{ node: 'Record Publish Failure', type: 'main', index: 0 }]] },
  'Live Meta Mode': { main: [[{ node: 'Publish Meta Container', type: 'main', index: 0 }], [{ node: 'Normalize Publication Result', type: 'main', index: 0 }]] },
  'Publish Meta Container': { main: [[{ node: 'Normalize Publication Result', type: 'main', index: 0 }], [{ node: 'Record Publish Failure', type: 'main', index: 0 }]] },
  'Normalize Publication Result': { main: [[{ node: 'Record Publication', type: 'main', index: 0 }]] },
  'Metrics Schedule': { main: [[{ node: 'Select Publications for Metrics', type: 'main', index: 0 }]] },
  'Select Publications for Metrics': { main: [[{ node: 'Has Publication for Metrics', type: 'main', index: 0 }]] },
  'Has Publication for Metrics': { main: [[{ node: 'Fetch Publication Metrics', type: 'main', index: 0 }], []] },
  'Fetch Publication Metrics': { main: [[{ node: 'Store Publication Metrics', type: 'main', index: 0 }], []] },
};

const analyticsCode = String.raw`
const row=$json;
const markdown=['# EduFlow — отчёт за '+row.report_date,'','- Новые контакты: **'+row.new_contacts+'**','- Новые лиды: **'+row.new_leads+'**','- Горячие лиды: **'+row.hot_leads+'**','- Входящие DM: **'+row.direct_messages+'**','- Комментарии: **'+row.comments+'**','- Автоответы: **'+row.automatic_replies+'**','- Передано менеджеру: **'+row.manager_handoffs+'**','- Публикации: **'+row.publications+'**','- Ошибки: **'+row.errors+'**','- Конверсия комментариев: **'+row.comment_conversion+'%**','- Конверсия DM: **'+row.dm_conversion+'%**','- Среднее время обработки: **'+row.avg_processing_ms+' ms**','- Лучшая публикация: **'+(row.top_publication||'нет данных')+'**'].join('\n');
return [{json:{...row,markdown,metrics:row,telegram_enabled:$env.TELEGRAM_ENABLED==='true'}}];`;

const analyticsNodes = [
  note('Analytics Architecture', [-760, -400], '## 04 — Daily analytics\n\nRuns every day at 09:00 and can also be invoked by an authenticated test webhook. Aggregation stays in PostgreSQL, the rendered Markdown report is upserted by date, and Telegram delivery is optional.'),
  node('Daily Schedule', 'n8n-nodes-base.scheduleTrigger', [-720, -80], { rule: { interval: [{ triggerAtHour: 9 }] } }, { typeVersion: 1.2 }),
  webhook('Analytics Webhook', [-720, 120], 'eduflow/analytics/run', 'onReceived'),
  code('Prepare Report Date', [-450, 20], `const e=$json; const h=e.headers??{}; const b=e.body??e; if (Object.keys(h).length && h['x-eduflow-token']!==$env.MOCK_API_TOKEN) throw new Error('Unauthorized analytics request'); return [{json:{report_date:b.report_date??new Date().toISOString().slice(0,10)}}];`),
  pg('Aggregate Daily Metrics', [-190, 20], `SELECT * FROM eduflow_daily_metrics($1::date);`, '={{ [$json.report_date] }}'),
  code('Render Markdown Report', [70, 20], analyticsCode),
  pg('Store Daily Report', [330, 20], `INSERT INTO daily_reports(report_date,markdown,metrics) VALUES($1,$2,$3::jsonb)
ON CONFLICT(report_date) DO UPDATE SET markdown=EXCLUDED.markdown,metrics=EXCLUDED.metrics;
SELECT true AS ok,$1::date AS report_date,$2::text AS markdown,$4::boolean AS telegram_enabled;`, '={{ [$json.report_date,$json.markdown,JSON.stringify($json.metrics),$json.telegram_enabled] }}'),
  boolIf('Send Analytics Telegram', [580, 20], '={{ $json.telegram_enabled }}'),
  http('Telegram Daily Report', [830, -80], 'POST', '={{ "https://api.telegram.org/bot" + $env.TELEGRAM_BOT_TOKEN + "/sendMessage" }}', '={{ JSON.stringify({chat_id:$env.TELEGRAM_CHAT_ID,text:$json.markdown,parse_mode:"Markdown"}) }}', { retries: true, onError: true, headers: false }),
];

const analyticsConnections = {
  'Daily Schedule': { main: [[{ node: 'Prepare Report Date', type: 'main', index: 0 }]] },
  'Analytics Webhook': { main: [[{ node: 'Prepare Report Date', type: 'main', index: 0 }]] },
  'Prepare Report Date': { main: [[{ node: 'Aggregate Daily Metrics', type: 'main', index: 0 }]] },
  'Aggregate Daily Metrics': { main: [[{ node: 'Render Markdown Report', type: 'main', index: 0 }]] },
  'Render Markdown Report': { main: [[{ node: 'Store Daily Report', type: 'main', index: 0 }]] },
  'Store Daily Report': { main: [[{ node: 'Send Analytics Telegram', type: 'main', index: 0 }]] },
  'Send Analytics Telegram': { main: [[{ node: 'Telegram Daily Report', type: 'main', index: 0 }], []] },
};

const errorNodes = [
  note('Error Architecture', [-650, -370], '## 05 — Central error handler\n\nReceives n8n error events from all production workflows, removes sensitive detail, assigns a stable fingerprint, stores the incident, and optionally alerts Telegram. Successful executions are not persisted by the main workflows.'),
  node('Workflow Error Trigger', 'n8n-nodes-base.errorTrigger', [-600, 0], {}, { typeVersion: 1 }),
  code('Sanitize Error', [-330, 0], String.raw`const e=$json; const execution=e.execution??{}; const workflow=e.workflow??{}; const err=execution.error??e.error??{}; const message=String(err.message??'Unknown workflow error').replace(/(token|secret|password|authorization)[^\s,}]*/gi,'$1=[REDACTED]').slice(0,2000); const node=String(execution.lastNodeExecuted??err.node?.name??'unknown'); const workflowName=String(workflow.name??'unknown'); const executionId=String(execution.id??$execution.id); const status=Number(err.httpCode??err.statusCode??0)||null; const fingerprint=(workflowName+'|'+node+'|'+message.slice(0,160)).toLowerCase(); return [{json:{workflow_name:workflowName,execution_id:executionId,node_name:node,severity:status>=500?'critical':'error',error_message:message,http_status:status,source:'n8n',correlation_id:'error-'+executionId,fingerprint,sanitized_details:{workflow_id:workflow.id??null,mode:execution.mode??null,url:execution.url??null},telegram_enabled:$env.TELEGRAM_ENABLED==='true'}}];`),
  pg('Store Error Log', [-60, 0], `INSERT INTO error_logs(workflow_name,execution_id,node_name,severity,error_message,http_status,source,correlation_id,fingerprint,sanitized_details)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
RETURNING id,workflow_name,node_name,severity,error_message,correlation_id,$11::boolean AS telegram_enabled;`, '={{ [$json.workflow_name,$json.execution_id,$json.node_name,$json.severity,$json.error_message,$json.http_status,$json.source,$json.correlation_id,$json.fingerprint,JSON.stringify($json.sanitized_details),$json.telegram_enabled] }}'),
  boolIf('Alert Telegram', [210, 0], '={{ $json.telegram_enabled }}'),
  http('Telegram Error Alert', [460, -100], 'POST', '={{ "https://api.telegram.org/bot" + $env.TELEGRAM_BOT_TOKEN + "/sendMessage" }}', '={{ JSON.stringify({chat_id:$env.TELEGRAM_CHAT_ID,text:"🚨 EduFlow n8n error\nWorkflow: "+$json.workflow_name+"\nNode: "+$json.node_name+"\nSeverity: "+$json.severity+"\nCorrelation: "+$json.correlation_id}) }}', { retries: true, onError: true, headers: false }),
];

const errorConnections = {
  'Workflow Error Trigger': { main: [[{ node: 'Sanitize Error', type: 'main', index: 0 }]] },
  'Sanitize Error': { main: [[{ node: 'Store Error Log', type: 'main', index: 0 }]] },
  'Store Error Log': { main: [[{ node: 'Alert Telegram', type: 'main', index: 0 }]] },
  'Alert Telegram': { main: [[{ node: 'Telegram Error Alert', type: 'main', index: 0 }], []] },
};

const files = [
  ['01-instagram-dm-lead.json', workflow(ids.dm, '01 EduFlow - DM Lead Qualification', dmNodes, dmConnections)],
  ['02-comment-to-lead.json', workflow(ids.comment, '02 EduFlow - Comment to Lead', commentNodes, commentConnections)],
  ['03-content-approval-publishing.json', workflow(ids.content, '03 EduFlow - Content Approval Publishing', contentNodes, contentConnections)],
  ['04-daily-analytics.json', workflow(ids.analytics, '04 EduFlow - Daily Analytics', analyticsNodes, analyticsConnections)],
  ['05-error-handler.json', workflow(ids.error, '05 EduFlow - Central Error Handler', errorNodes, errorConnections, { ...baseSettings, errorWorkflow: undefined })],
];

await mkdir(outDir, { recursive: true });
for (const [name, data] of files) {
  if (data.settings.errorWorkflow === undefined) delete data.settings.errorWorkflow;
  await writeFile(path.join(outDir, name), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
await import('./harden-workflows-no-code.mjs');
process.stdout.write(`Generated ${files.length} EduFlow workflows in ${outDir}\n`);
