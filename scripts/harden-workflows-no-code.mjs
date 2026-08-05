import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const workflowsDir = path.resolve('workflows');

function byName(workflow, name) {
  const found = workflow.nodes.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing node ${name} in ${workflow.name}`);
  return found;
}

function removeNodes(workflow, names) {
  const unwanted = new Set(names);
  workflow.nodes = workflow.nodes.filter((candidate) => !unwanted.has(candidate.name));
  for (const name of names) delete workflow.connections[name];
  for (const connection of Object.values(workflow.connections)) {
    for (const outputs of connection.main ?? []) {
      for (let index = outputs.length - 1; index >= 0; index -= 1) {
        if (unwanted.has(outputs[index].node)) outputs.splice(index, 1);
      }
    }
  }
}

function booleanIf(name, position, expression) {
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: `${name}-condition`, leftValue: expression, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and',
      },
      options: {},
    },
    id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-guard`, name,
    type: 'n8n-nodes-base.if', typeVersion: 2.2, position,
  };
}

function setResult(name, position, assignments) {
  return {
    parameters: {
      assignments: { assignments: assignments.map(([field, value, type = 'string'], index) => ({ id: `${name}-${index}`, name: field, value, type })) },
      options: {},
    },
    id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-result`, name,
    type: 'n8n-nodes-base.set', typeVersion: 3.4, position,
  };
}

function main(node, output = 0) {
  const outputs = [];
  outputs[output] = [{ node, type: 'main', index: 0 }];
  return { main: outputs };
}

async function load(name) {
  return JSON.parse(await readFile(path.join(workflowsDir, name), 'utf8'));
}

async function save(name, workflow) {
  await writeFile(path.join(workflowsDir, name), `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
}

const dmFile = '01-instagram-dm-lead.json';
const dm = await load(dmFile);
removeNodes(dm, ['Normalize and Qualify DM']);
dm.nodes.push(booleanIf('Authorized DM Event', [-500, 0], '={{ $env.META_MODE !== "mock" || $json.headers?.["x-eduflow-token"] === $env.MOCK_API_TOKEN }}'));
const dmStore = byName(dm, 'Store DM Transaction');
dmStore.parameters.query = `WITH input AS (
  SELECT $1::text event_id,$2::text user_id,$3::text username,left($4::text,4000) body,
    COALESCE(NULLIF($5::text,''),now()::text)::timestamptz event_time,$6::text account_id,
    $7::text correlation_id,$8::jsonb payload,$9::int threshold
), qualified AS (
  SELECT *,
    CASE WHEN lower(body) ~ '(сколько|цена|стоим|рассроч|оплат)' THEN 'pricing'
         WHEN lower(body) ~ '(консультац|позвон|связаться|менеджер)' THEN 'consultation'
         WHEN lower(body) ~ '(курс|обуч|python|программ)' THEN 'course_interest' ELSE 'general' END intent,
    CASE WHEN lower(body) ~ '(сколько|цена|стоим|рассроч|оплат)' AND lower(body) ~ '(хочу|купить|запис)' THEN 75
         WHEN lower(body) ~ '(сколько|цена|стоим|рассроч|оплат)' THEN 55
         WHEN lower(body) ~ '(консультац|позвон|связаться|менеджер)' THEN 70
         WHEN lower(body) ~ '(курс|обуч|python|программ)' THEN 40 ELSE 15 END score,
    CASE WHEN lower(body) ~ '(сколько|цена|стоим|рассроч|оплат)' THEN 'Спасибо за интерес к EduFlow! Я отправлю актуальную программу и варианты оплаты. Напишите ваш уровень и удобное время для консультации.'
         WHEN lower(body) ~ '(консультац|позвон|связаться|менеджер)' THEN 'Отлично, передаю запрос менеджеру EduFlow. Напишите удобное время и часовой пояс — свяжемся с вами.'
         WHEN lower(body) ~ '(курс|обуч|python|программ)' THEN 'Расскажу подробнее! Какой у вас текущий уровень и какую задачу хотите решить обучением?'
         ELSE 'Спасибо за сообщение! Подскажите, какая программа и цель обучения вам интересны?' END reply_text
  FROM input
), ready AS (
  SELECT *,CASE WHEN score>=threshold THEN 'HOT' WHEN score>=30 THEN 'WARM' ELSE 'QUALIFYING' END lead_status FROM qualified
)
SELECT result.*,ready.event_id,ready.user_id,ready.correlation_id
FROM ready CROSS JOIN LATERAL eduflow_process_dm(ready.event_id,ready.user_id,ready.username,ready.body,ready.event_time,ready.account_id,ready.intent,ready.score,ready.lead_status,ready.reply_text,ready.correlation_id,ready.payload) result;`;
dmStore.parameters.options.queryReplacement = '={{ [$json.body?.event_id || $json.body?.entry?.[0]?.messaging?.[0]?.message?.mid || "",$json.body?.user_id || $json.body?.entry?.[0]?.messaging?.[0]?.sender?.id || "",$json.body?.username || "",$json.body?.text || $json.body?.entry?.[0]?.messaging?.[0]?.message?.text || "",$json.body?.timestamp || "",$json.body?.instagram_account_id || "",$json.headers?.["x-request-id"] || "dm-"+($json.body?.event_id || $execution.id),JSON.stringify($json.body || {}),Number($env.HOT_LEAD_THRESHOLD || 50)] }}';
dm.connections['Instagram DM Webhook'] = main('Authorized DM Event');
dm.connections['Authorized DM Event'] = { main: [[{ node: 'Store DM Transaction', type: 'main', index: 0 }], []] };
await save(dmFile, dm);

const commentFile = '02-comment-to-lead.json';
const comment = await load(commentFile);
removeNodes(comment, ['Normalize Comment']);
comment.nodes.push(booleanIf('Authorized Comment Event', [-500, 0], '={{ $env.META_MODE !== "mock" || $json.headers?.["x-eduflow-token"] === $env.MOCK_API_TOKEN }}'));
const commentStore = byName(comment, 'Store Comment Transaction');
commentStore.parameters.query = `WITH input AS (
  SELECT $1::text comment_id,$2::text media_id,$3::text user_id,$4::text username,left($5::text,4000) body,$6::text correlation_id,$7::jsonb payload
), matched AS (
  SELECT *,CASE WHEN lower(body) LIKE '%гайд%' THEN 'гайд' WHEN lower(body) LIKE '%пробн%' THEN 'пробный'
    WHEN lower(body) LIKE '%урок%' THEN 'урок' WHEN lower(body) LIKE '%курс%' THEN 'курс'
    WHEN lower(body) LIKE '%python%' THEN 'python' WHEN lower(body) LIKE '%обуч%' THEN 'обучение'
    WHEN lower(body) LIKE '%чек-лист%' THEN 'чек-лист' ELSE '' END keyword FROM input
), ready AS (
  SELECT *,CASE WHEN lower(body) ~ '(хочу|купить|запис|цена|стоим)' THEN true ELSE false END hot,
    CASE WHEN lower(body) LIKE '%python%' THEN 'python-organic' WHEN keyword<>'' THEN 'education-organic' ELSE 'unmatched' END campaign,
    CASE WHEN keyword<>'' THEN 'Спасибо за интерес! Отправляем материалы EduFlow в личные сообщения. Если нужна консультация — ответьте «хочу консультацию».' ELSE '' END reply_text
  FROM matched
)
SELECT result.*,ready.comment_id,ready.media_id,ready.user_id,ready.correlation_id
FROM ready CROSS JOIN LATERAL eduflow_process_comment(ready.comment_id,ready.media_id,ready.user_id,ready.username,ready.body,ready.keyword,ready.campaign,ready.reply_text,ready.hot,ready.correlation_id,ready.payload) result;`;
commentStore.parameters.options.queryReplacement = '={{ [$json.body?.comment_id || $json.body?.entry?.[0]?.changes?.[0]?.value?.id || "",$json.body?.media_id || $json.body?.entry?.[0]?.changes?.[0]?.value?.media?.id || "",$json.body?.user_id || $json.body?.entry?.[0]?.changes?.[0]?.value?.from?.id || "",$json.body?.username || $json.body?.entry?.[0]?.changes?.[0]?.value?.from?.username || "",$json.body?.text || $json.body?.entry?.[0]?.changes?.[0]?.value?.text || "",$json.headers?.["x-request-id"] || "comment-"+($json.body?.comment_id || $execution.id),JSON.stringify($json.body || {})] }}';
comment.connections['Instagram Comment Webhook'] = main('Authorized Comment Event');
comment.connections['Authorized Comment Event'] = { main: [[{ node: 'Store Comment Transaction', type: 'main', index: 0 }], []] };
await save(commentFile, comment);

const contentFile = '03-content-approval-publishing.json';
const content = await load(contentFile);
removeNodes(content, ['Validate Content', 'Validate Decision', 'Return Decision Result', 'Prepare Publish Request', 'Normalize Publication Result']);
content.nodes.push(
  booleanIf('Valid Content Request', [-700, -120], '={{ $json.headers?.["x-eduflow-token"] === $env.MOCK_API_TOKEN && Boolean($json.body?.title && $json.body?.content_type && $json.body?.caption && $json.body?.media_url && $json.body?.created_by) && ["image","carousel","reels","story"].includes($json.body?.content_type) && String($json.body?.media_url).startsWith("https://") && String($env.ALLOWED_MEDIA_HOSTS || "example.com").split(",").some(host => String($json.body?.media_url).startsWith("https://"+host.trim()+"/") || String($json.body?.media_url).includes("."+host.trim()+"/")) }}'),
  setResult('Invalid Content Request', [-450, -300], [['ok', false, 'boolean'], ['status', 'INVALID_OR_UNAUTHORIZED']]),
  booleanIf('Valid Decision Request', [-700, 140], '={{ ($json.headers?.["x-approval-secret"] || $json.body?.secret) === $env.APPROVAL_SECRET && ["approve","reject"].includes(String($json.body?.decision || "").toLowerCase()) && Boolean($json.body?.public_id) }}'),
  setResult('Invalid Decision Request', [-450, 300], [['ok', false, 'boolean'], ['status', 'INVALID_OR_UNAUTHORIZED']]),
  setResult('Decision Not Due', [80, 300], [['ok', true, 'boolean'], ['public_id', '={{ $json.public_id }}'], ['status', '={{ $json.status }}']]),
);
const createDraft = byName(content, 'Create Draft');
createDraft.parameters.options.queryReplacement = '={{ [$json.body.public_id || "content-"+$execution.id,$json.body.title,$json.body.content_type,$json.body.caption,$json.body.media_url,$json.body.scheduled_at || null,$json.body.campaign || "",$json.body.created_by,$json.headers?.["x-request-id"] || "content-"+$execution.id] }}';
const recordDecision = byName(content, 'Record Decision');
recordDecision.parameters.options.queryReplacement = '={{ [$json.body.public_id,String($json.body.decision).toLowerCase(),$json.body.reason || "",Boolean($json.body.immediate)] }}';
const recordPublication = byName(content, 'Record Publication');
recordPublication.parameters.options.queryReplacement = '={{ [$("Record Decision").isExecuted ? $("Record Decision").item.json.public_id : $("Select Due Content").item.json.public_id,$json.publication_id || $json.id || "",$json.request_id || "",JSON.stringify($json)] }}';
const recordPublishFailure = byName(content, 'Record Publish Failure');
recordPublishFailure.parameters.options.queryReplacement = '={{ [$("Record Decision").isExecuted ? $("Record Decision").item.json.public_id : $("Select Due Content").item.json.public_id,$execution.id,String($json.message || $json.error || "Publish failed"),Number($json.httpCode || $json.statusCode || 500),$("Record Decision").isExecuted ? $("Record Decision").item.json.correlation_id : $("Select Due Content").item.json.correlation_id] }}';
content.connections['Create Content Webhook'] = main('Valid Content Request');
content.connections['Valid Content Request'] = { main: [[{ node: 'Create Draft', type: 'main', index: 0 }], [{ node: 'Invalid Content Request', type: 'main', index: 0 }]] };
content.connections['Decision Webhook'] = main('Valid Decision Request');
content.connections['Valid Decision Request'] = { main: [[{ node: 'Record Decision', type: 'main', index: 0 }], [{ node: 'Invalid Decision Request', type: 'main', index: 0 }]] };
content.connections['Publish Decision Now'] = { main: [[{ node: 'Create Content Container', type: 'main', index: 0 }], [{ node: 'Decision Not Due', type: 'main', index: 0 }]] };
content.connections['Has Due Content'] = { main: [[{ node: 'Create Content Container', type: 'main', index: 0 }], []] };
content.connections['Live Meta Mode'] = { main: [[{ node: 'Publish Meta Container', type: 'main', index: 0 }], [{ node: 'Record Publication', type: 'main', index: 0 }]] };
content.connections['Publish Meta Container'] = { main: [[{ node: 'Record Publication', type: 'main', index: 0 }], [{ node: 'Record Publish Failure', type: 'main', index: 0 }]] };
await save(contentFile, content);

const analyticsFile = '04-daily-analytics.json';
const analytics = await load(analyticsFile);
removeNodes(analytics, ['Prepare Report Date', 'Render Markdown Report', 'Store Daily Report']);
analytics.nodes.push(booleanIf('Authorized Analytics', [-430, 20], '={{ !$json.headers || $json.headers?.["x-eduflow-token"] === $env.MOCK_API_TOKEN }}'));
const aggregate = byName(analytics, 'Aggregate Daily Metrics');
aggregate.parameters.query = `WITH metrics AS (SELECT * FROM eduflow_daily_metrics($1::date)), rendered AS (
  SELECT metrics.*,concat('# EduFlow — отчёт за ',report_date,E'\n\n',
    '- Новые контакты: **',new_contacts,E'**\n','- Новые лиды: **',new_leads,E'**\n','- Горячие лиды: **',hot_leads,E'**\n',
    '- Входящие DM: **',direct_messages,E'**\n','- Комментарии: **',comments,E'**\n','- Автоответы: **',automatic_replies,E'**\n',
    '- Передано менеджеру: **',manager_handoffs,E'**\n','- Публикации: **',publications,E'**\n','- Ошибки: **',errors,E'**\n',
    '- Конверсия комментариев: **',comment_conversion,E'%**\n','- Конверсия DM: **',dm_conversion,E'%**\n',
    '- Среднее время обработки: **',avg_processing_ms,E' ms**\n','- Лучшая публикация: **',coalesce(top_publication,'нет данных'),'**') markdown
  FROM metrics
), stored AS (
  INSERT INTO daily_reports(report_date,markdown,metrics) SELECT report_date,markdown,to_jsonb(rendered)-'markdown' FROM rendered
  ON CONFLICT(report_date) DO UPDATE SET markdown=EXCLUDED.markdown,metrics=EXCLUDED.metrics
  RETURNING report_date,markdown,metrics
)
SELECT true AS ok,report_date,markdown,metrics,$2::boolean AS telegram_enabled FROM stored;`;
aggregate.parameters.options.queryReplacement = '={{ [$json.body?.report_date || new Date().toISOString().slice(0,10),$env.TELEGRAM_ENABLED === "true"] }}';
analytics.connections['Daily Schedule'] = main('Authorized Analytics');
analytics.connections['Analytics Webhook'] = main('Authorized Analytics');
analytics.connections['Authorized Analytics'] = { main: [[{ node: 'Aggregate Daily Metrics', type: 'main', index: 0 }], []] };
analytics.connections['Aggregate Daily Metrics'] = main('Send Analytics Telegram');
await save(analyticsFile, analytics);

const errorFile = '05-error-handler.json';
const errorWorkflow = await load(errorFile);
removeNodes(errorWorkflow, ['Sanitize Error']);
const storeError = byName(errorWorkflow, 'Store Error Log');
storeError.parameters.options.queryReplacement = '={{ [$json.workflow?.name || "unknown",String($json.execution?.id || $execution.id),$json.execution?.lastNodeExecuted || $json.execution?.error?.node?.name || "unknown",Number($json.execution?.error?.httpCode || $json.execution?.error?.statusCode || 0) >= 500 ? "critical" : "error",String($json.execution?.error?.message || "Unknown workflow error").replace(/(token|secret|password|authorization)[^\\s,}]*/gi,"$1=[REDACTED]").slice(0,2000),Number($json.execution?.error?.httpCode || $json.execution?.error?.statusCode || 0) || null,"n8n","error-"+String($json.execution?.id || $execution.id),String(($json.workflow?.name || "unknown")+"|"+($json.execution?.lastNodeExecuted || "unknown")+"|"+($json.execution?.error?.message || "unknown")).toLowerCase().slice(0,500),JSON.stringify({workflow_id:$json.workflow?.id || null,mode:$json.execution?.mode || null,url:$json.execution?.url || null}),$env.TELEGRAM_ENABLED === "true"] }}';
errorWorkflow.connections['Workflow Error Trigger'] = main('Store Error Log');
await save(errorFile, errorWorkflow);

process.stdout.write('Hardened five workflows to avoid runtime Code-node dependencies\n');
