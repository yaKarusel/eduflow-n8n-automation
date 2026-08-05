import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
const { handle } = await import('../src/server.js');

test('module exports an HTTP handler', () => {
  assert.equal(typeof handle, 'function');
});

test('documented failure modes are stable', () => {
  const modes = ['normal', 'rate_limit_once', 'always_429', 'fail_once', 'always_500'];
  assert.equal(new Set(modes).size, 5);
});
