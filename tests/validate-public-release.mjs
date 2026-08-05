import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';

const root = process.cwd();
const ignoredDirectories = new Set(['.git', 'node_modules', 'backups', 'tmp']);
const textExtensions = new Set(['.md', '.yml', '.yaml', '.json', '.js', '.mjs', '.cjs', '.sh', '.sql', '.txt', '.example', '.svg']);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const files = walk(root);
const forbidden = [
  ['deployment IP', /132\.243\.230\.150/],
  ['temporary DNS hostname', new RegExp('sslip' + '\\.io', 'i')],
  ['private proxy URI', new RegExp('vless' + ':\\/\\/', 'i')],
  ['private key', new RegExp('BEGIN .*PRIVATE' + ' KEY', 'i')],
  ['personal email address', /@gmail\.com/i],
  ['server-specific project path', /\/opt\/eduflow-n8n/i],
  ['deployable n8n project ID', /N8N_PROJECT_ID=[A-Za-z0-9_-]{8,}/],
  ['deployable n8n owner ID', /N8N_OWNER_ID=[A-Fa-f0-9-]{16,}/],
];

const releaseLeaks = [];
for (const file of files) {
  const extension = extname(file);
  if (!textExtensions.has(extension) && !['Makefile', 'LICENSE', '.gitignore'].includes(file.split(/[\\/]/).at(-1))) continue;
  const content = readFileSync(file, 'utf8');
  for (const [label, pattern] of forbidden) if (pattern.test(content)) releaseLeaks.push(`${file}: ${label}`);
}
assert.deepEqual(releaseLeaks, [], `public release contains private deployment data:\n${releaseLeaks.join('\n')}`);

const brokenLinks = [];
for (const file of files.filter((path) => extname(path) === '.md')) {
  const content = readFileSync(file, 'utf8');
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^(https?:|mailto:)/i.test(target)) continue;
    const resolved = resolve(dirname(file), decodeURIComponent(target));
    if (!existsSync(resolved) || !statSync(resolved)) brokenLinks.push(`${file} -> ${target}`);
  }
}
assert.deepEqual(brokenLinks, [], `broken local documentation links:\n${brokenLinks.join('\n')}`);

for (const required of ['README.md', 'LICENSE', 'docs/assets/hero.svg', 'docs/assets/hero.png', '.github/workflows/ci.yml']) {
  assert.ok(existsSync(join(root, required)), `missing public artifact: ${required}`);
}

process.stdout.write(`Public release validation passed: ${files.length} files, no private deployment markers, no broken local links\n`);
