import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const files = (await readdir('workflows')).filter((name) => name.endsWith('.json')).sort();
assert.equal(files.length, 5, 'exactly five workflows are required');
const ids = new Set();
for (const file of files) {
  const workflow = JSON.parse(await readFile(`workflows/${file}`, 'utf8'));
  assert.ok(workflow.id && workflow.name && Array.isArray(workflow.nodes));
  assert.ok(!ids.has(workflow.id), `duplicate workflow id ${workflow.id}`);
  ids.add(workflow.id);
  const names = new Set(workflow.nodes.map((node) => node.name));
  assert.equal(names.size, workflow.nodes.length, `${file} has duplicate node names`);
  assert.equal(workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.code').length, 0, `${file} must not depend on Code-node runners`);
  for (const node of workflow.nodes.filter((item) => item.type === 'n8n-nodes-base.postgres')) {
    const query = node.parameters?.query ?? '';
    if (/\$\d+/.test(query)) {
      assert.ok(node.parameters?.options?.queryReplacement, `${file}:${node.name} must bind every SQL placeholder through Query Parameters`);
    }
  }
  for (const [source, connection] of Object.entries(workflow.connections)) {
    assert.ok(names.has(source), `${file} missing source ${source}`);
    for (const output of connection.main ?? []) for (const edge of output) assert.ok(names.has(edge.node), `${file} missing target ${edge.node}`);
  }
  if (workflow.id !== 'EFERROR000000001') assert.equal(workflow.settings.errorWorkflow, 'EFERROR000000001');
}
process.stdout.write('Workflow validation passed: 5 files, unique IDs, valid edges, parameter-bound SQL, no Code nodes\n');
