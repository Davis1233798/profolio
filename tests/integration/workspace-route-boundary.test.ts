import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { middleware } from '../../middleware';
import { runWithDatabase, getDb } from '../../db';
import { createSqliteD1 } from '../../lib/db/sqlite-d1';
import { organizations } from '../../db/schema';
import { GET as download, POST as restore } from '../../app/api/workspace/backup/route';
import { GET as csv } from '../../app/api/workspace/export/route';
import { readWorkspaceJson, workspaceDownload } from '../../lib/workspace-http';

test('workspace transfer bounds reject chunked oversized input and oversized downloads', async () => {
  const request = new Request('https://portfolio.example.test/api/workspace/backup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'x'.repeat(100) }) });
  await assert.rejects(readWorkspaceJson(request, 20), { status: 413 });
  assert.throws(() => workspaceDownload('x'.repeat(10_000_001), 'backup.json', 'application/json'), { status: 413 });
});

test('protected workspace/auth requests never create anonymous demo organizations', async () => {
  const binding = createSqliteD1();
  await runWithDatabase(binding, async () => {
    for (const path of ['/api/workspace/backup', '/api/workspace/export', '/api/workspace-auth/sign-in/email', '/api/workspace-admin/session', '/admin/workspace']) {
      const response = await middleware(new NextRequest(`https://portfolio.example.test${path}`));
      assert.equal(response.headers.get('set-cookie'), null, path);
    }
    assert.equal((await getDb().select().from(organizations)).length, 0);
  });
});

test('missing real auth configuration rejects demo-admin downloads and restore before reading its body', async () => {
  const prior = process.env.BETTER_AUTH_SECRET;
  delete process.env.BETTER_AUTH_SECRET;
  const headers = { cookie: `demo_session_id=${crypto.randomUUID()}; demo_user_role=admin` };
  try {
    for (const [handler, path] of [[download, 'backup'], [csv, 'export']] as const) {
      const response = await handler(new NextRequest(`https://portfolio.example.test/api/workspace/${path}`, { headers }));
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    const request = new NextRequest('https://portfolio.example.test/api/workspace/backup', { method: 'POST', headers, body: '{}' });
    Object.defineProperty(request, 'body', { get() { throw new Error('Unauthenticated body must not be consumed'); } });
    request.text = async () => { throw new Error('Unauthenticated body must not be consumed'); };
    assert.equal((await restore(request)).status, 503);
  } finally {
    if (prior === undefined) delete process.env.BETTER_AUTH_SECRET; else process.env.BETTER_AUTH_SECRET = prior;
  }
});
