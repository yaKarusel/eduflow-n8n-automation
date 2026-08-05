import process from 'node:process';

const route = process.argv[2];
const mockRoute = /^\/(mock\/events\/(dm|comment)|admin\/failure-mode)$/.test(route || '');
const n8nRoute = /^\/n8n\/(content\/(create|decision)|analytics\/run)$/.test(route || '');
if (!route || (!mockRoute && !n8nRoute)) {
  process.stderr.write('Usage: node src/cli.js /mock/events/dm|/mock/events/comment|/admin/failure-mode|/n8n/content/create|/n8n/content/decision|/n8n/analytics/run\n');
  process.exit(2);
}

let body = '';
for await (const chunk of process.stdin) body += chunk;
JSON.parse(body);
const target = mockRoute
  ? `http://127.0.0.1:${process.env.PORT || 8080}${route}`
  : `${process.env.N8N_INTERNAL_URL}/webhook/eduflow/${route.slice('/n8n/'.length)}`;
const response = await fetch(target, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-token': process.env.MOCK_API_TOKEN,
    'x-eduflow-token': process.env.MOCK_API_TOKEN,
    'x-approval-secret': process.env.APPROVAL_SECRET || '',
  },
  body,
});
const responseText = await response.text();
process.stdout.write(`${response.status}\n${responseText}\n`);
if (!response.ok) process.exit(1);
