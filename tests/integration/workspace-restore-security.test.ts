import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceSecurityForTest, authorizeWorkspaceRestore, confirmWorkspacePassword } from '../../lib/workspace-security';

test('restore needs owner membership and current password; preflight consumes no restore quota', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-restore-auth-'));
  const origin = 'https://portfolio.example.test';
  const security = await createWorkspaceSecurityForTest({ databasePath: join(directory, 'auth.sqlite'), baseURL: origin, secret: 'synthetic-restore-only-secret-at-least-32-bytes', owner: { email: 'owner@example.test', password: 'CI-only-owner-password-9931' } });
  try {
    const login = await security.request('/api/workspace-auth/sign-in/email', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.test', password: 'CI-only-owner-password-9931' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const session = await security.request('/api/workspace-admin/session', { headers: { cookie } });
    const { user } = await session.json() as { user: { id: string } };
    const request = (method: string, requestOrigin = origin) => new Request(`${origin}/api/workspace/backup?workspaceId=restore-a`, { method, headers: { origin: requestOrigin, cookie } });
    await assert.rejects(authorizeWorkspaceRestore(request('HEAD'), security.runtime, origin), { status: 403 }, 'being owner alone is insufficient');
    const grant = await security.request('/api/workspace-admin/memberships', { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ userId: user.id, workspaceId: 'restore-a', permissions: ['restore'] }) });
    assert.equal(grant.status, 200);
    for (let index = 0; index < 6; index++) await authorizeWorkspaceRestore(request('HEAD'), security.runtime, origin);
    const principal = await authorizeWorkspaceRestore(request('POST'), security.runtime, origin);
    assert.equal(principal.organizationId, 'restore-a');
    await assert.rejects(authorizeWorkspaceRestore(request('POST', 'https://other.example.test'), security.runtime, origin), { status: 403 });
    await assert.rejects(confirmWorkspacePassword(request('POST'), 'wrong-password-9931', security.runtime), { status: 401 });
    const before = security.runtime.sqlite.prepare('SELECT count(*) AS count FROM session').get() as { count: number };
    await confirmWorkspacePassword(request('POST'), 'CI-only-owner-password-9931', security.runtime);
    const after = security.runtime.sqlite.prepare('SELECT count(*) AS count FROM session').get() as { count: number };
    assert.equal(after.count, before.count, 'password confirmation must not create another session');
    for (let index = 0; index < 4; index++) await authorizeWorkspaceRestore(request('POST'), security.runtime, origin);
    await assert.rejects(authorizeWorkspaceRestore(request('POST'), security.runtime, origin), { status: 429 }, 'restore has a durable per-user budget');
  } finally { await security.close(); await rm(directory, { recursive: true, force: true }); }
});
