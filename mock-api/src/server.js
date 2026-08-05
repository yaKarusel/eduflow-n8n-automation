import http from 'node:http';
import { appendFile, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

const port = parseInteger(process.env.PORT, 8080, 1, 65535);
const maxBodyBytes = parseInteger(process.env.MAX_BODY_BYTES, 262_144, 1024, 1_048_576);
const maxLogBytes = parseInteger(process.env.MAX_LOG_BYTES, 1_048_576, 16_384, 10_485_760);
const logFile = process.env.LOG_FILE || '/data/requests.jsonl';
const apiToken = process.env.MOCK_API_TOKEN || '';
const n8nUrl = (process.env.N8N_INTERNAL_URL || 'http://n8n:5678').replace(/\/$/, '');
const validFailureModes = new Set(['normal', 'rate_limit_once', 'always_429', 'fail_once', 'always_500']);
let failureMode = 'normal';
let failureConsumed = false;

function parseInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function json(res, status, body, requestId) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-request-id': requestId,
  });
  res.end(payload);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function authorized(req) {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return apiToken.length >= 24 && (safeEqual(req.headers['x-api-token'], apiToken) || safeEqual(bearer, apiToken));
}

async function readJson(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) {
      const error = new Error('Request body exceeds the configured limit');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (bytes === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('object required');
    return value;
  } catch {
    const error = new Error('Request body must be a valid JSON object');
    error.statusCode = 400;
    throw error;
  }
}

function redact(value, depth = 0) {
  if (depth > 6) return '[DEPTH_LIMIT]';
  if (Array.isArray(value)) return value.slice(0, 25).map((entry) => redact(entry, depth + 1));
  if (!value || typeof value !== 'object') return typeof value === 'string' && value.length > 500 ? `${value.slice(0, 500)}…` : value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = /token|secret|password|authorization|cookie|api.?key/i.test(key) ? '[REDACTED]' : redact(entry, depth + 1);
  }
  return out;
}

async function rotateLogIfNeeded() {
  try {
    const info = await stat(logFile);
    if (info.size < maxLogBytes) return;
    await rename(logFile, `${logFile}.1`).catch(() => {});
    await writeFile(logFile, '', { mode: 0o600 });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function logRequest(record) {
  await rotateLogIfNeeded();
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...redact(record) });
  await appendFile(logFile, `${line}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function recentLogs(limit = 100) {
  try {
    const content = await readFile(logFile, 'utf8');
    return content.trim().split('\n').filter(Boolean).slice(-Math.min(limit, 250)).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function required(body, fields) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === null || body[field] === '');
  if (missing.length) {
    const error = new Error(`Missing required fields: ${missing.join(', ')}`);
    error.statusCode = 422;
    throw error;
  }
}

function stableNumber(value, modulo, offset = 0) {
  const digest = createHash('sha256').update(String(value)).digest();
  return digest.readUInt32BE(0) % modulo + offset;
}

function plannedFailure() {
  if (failureMode === 'always_429') return { status: 429, code: 'RATE_LIMITED', retryAfter: 1 };
  if (failureMode === 'always_500') return { status: 500, code: 'MOCK_UPSTREAM_FAILURE' };
  if (failureMode === 'rate_limit_once' && !failureConsumed) {
    failureConsumed = true;
    return { status: 429, code: 'RATE_LIMITED', retryAfter: 1 };
  }
  if (failureMode === 'fail_once' && !failureConsumed) {
    failureConsumed = true;
    return { status: 500, code: 'MOCK_UPSTREAM_FAILURE' };
  }
  return null;
}

async function forwardEvent(path, body, requestId) {
  const response = await fetch(`${n8nUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-eduflow-token': apiToken, 'x-request-id': requestId },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let responseBody;
  try { responseBody = JSON.parse(text); } catch { responseBody = { message: text.slice(0, 1000) }; }
  return { status: response.status, body: responseBody };
}

export async function handle(req, res) {
  const requestId = String(req.headers['x-request-id'] || randomUUID());
  const url = new URL(req.url, 'http://localhost');
  const startedAt = Date.now();
  let requestBody;
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { status: 'ok', service: 'eduflow-mock-api', mode: process.env.META_MODE || 'mock', failure_mode: failureMode }, requestId);
    }
    if (!authorized(req)) return json(res, 401, { error: 'unauthorized', request_id: requestId }, requestId);

    if (req.method === 'GET' && url.pathname === '/logs') {
      const logs = await recentLogs(parseInteger(url.searchParams.get('limit'), 100, 1, 250));
      return json(res, 200, { logs, count: logs.length, request_id: requestId }, requestId);
    }

    if (req.method !== 'GET') requestBody = await readJson(req);

    if (req.method === 'POST' && url.pathname === '/admin/failure-mode') {
      required(requestBody, ['mode']);
      if (!validFailureModes.has(requestBody.mode)) return json(res, 422, { error: 'invalid_failure_mode', allowed: [...validFailureModes], request_id: requestId }, requestId);
      failureMode = requestBody.mode;
      failureConsumed = false;
      await logRequest({ request_id: requestId, method: req.method, path: url.pathname, status: 200, body: requestBody });
      return json(res, 200, { ok: true, mode: failureMode, request_id: requestId }, requestId);
    }

    if (req.method === 'POST' && url.pathname === '/mock/events/dm') {
      required(requestBody, ['event_id', 'user_id', 'text']);
      const forwarded = await forwardEvent('/webhook/eduflow/instagram/dm', requestBody, requestId);
      await logRequest({ request_id: requestId, method: req.method, path: url.pathname, status: forwarded.status, body: requestBody, response: forwarded.body, duration_ms: Date.now() - startedAt });
      return json(res, forwarded.status, forwarded.body, requestId);
    }

    if (req.method === 'POST' && url.pathname === '/mock/events/comment') {
      required(requestBody, ['comment_id', 'media_id', 'user_id', 'text']);
      const forwarded = await forwardEvent('/webhook/eduflow/instagram/comment', requestBody, requestId);
      await logRequest({ request_id: requestId, method: req.method, path: url.pathname, status: forwarded.status, body: requestBody, response: forwarded.body, duration_ms: Date.now() - startedAt });
      return json(res, forwarded.status, forwarded.body, requestId);
    }

    const outboundPaths = new Set(['/v1/messages/send', '/v1/comments/private-reply', '/v1/content/publish']);
    if (req.method === 'POST' && outboundPaths.has(url.pathname)) {
      const requirements = url.pathname === '/v1/messages/send' ? ['recipient_id', 'text'] : url.pathname === '/v1/comments/private-reply' ? ['comment_id', 'text'] : ['content_id', 'caption', 'media_url'];
      required(requestBody, requirements);
      const failure = plannedFailure();
      if (failure) {
        const response = { error: failure.code, request_id: requestId, retry_after: failure.retryAfter };
        await logRequest({ request_id: requestId, method: req.method, path: url.pathname, status: failure.status, body: requestBody, response, duration_ms: Date.now() - startedAt });
        if (failure.retryAfter) res.setHeader('retry-after', String(failure.retryAfter));
        return json(res, failure.status, response, requestId);
      }
      const identity = requestBody.recipient_id || requestBody.comment_id || requestBody.content_id;
      const prefix = url.pathname.includes('content') ? 'mock-pub' : url.pathname.includes('comments') ? 'mock-private-reply' : 'mock-msg';
      const response = { ok: true, request_id: requestId, id: `${prefix}-${createHash('sha256').update(String(identity)).digest('hex').slice(0, 16)}` };
      if (prefix === 'mock-pub') response.publication_id = response.id;
      else response.message_id = response.id;
      await logRequest({ request_id: requestId, method: req.method, path: url.pathname, status: 200, body: requestBody, response, duration_ms: Date.now() - startedAt });
      return json(res, 200, response, requestId);
    }

    const metricsMatch = req.method === 'GET' && url.pathname.match(/^\/v1\/content\/([^/]+)\/metrics$/);
    if (metricsMatch) {
      const id = decodeURIComponent(metricsMatch[1]);
      const response = {
        publication_id: id,
        impressions: stableNumber(id, 1500, 500), reach: stableNumber(`${id}:reach`, 1000, 300),
        likes: stableNumber(`${id}:likes`, 250, 20), comments: stableNumber(`${id}:comments`, 50, 2),
        saves: stableNumber(`${id}:saves`, 80, 1), shares: stableNumber(`${id}:shares`, 40, 1),
        measured_at: new Date().toISOString(), request_id: requestId,
      };
      await logRequest({ request_id: requestId, method: req.method, path: url.pathname, status: 200, response, duration_ms: Date.now() - startedAt });
      return json(res, 200, response, requestId);
    }

    return json(res, 404, { error: 'not_found', request_id: requestId }, requestId);
  } catch (error) {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    const message = status >= 500 ? 'Internal mock API error' : error.message;
    await logRequest({ request_id: requestId, method: req.method, path: url.pathname, status, body: requestBody, error: message, duration_ms: Date.now() - startedAt }).catch(() => {});
    return json(res, status, { error: message, request_id: requestId }, requestId);
  }
}

if (process.env.NODE_ENV !== 'test') {
  const server = http.createServer(handle);
  server.requestTimeout = 35_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.listen(port, '0.0.0.0', () => process.stdout.write(`EduFlow mock API listening on ${port}\n`));
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
