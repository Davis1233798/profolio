import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const base = process.argv[2] ?? 'http://127.0.0.1:8090';
const canonical = process.env.BETTER_AUTH_URL;
const email = process.env.WORKSPACE_BOOTSTRAP_EMAIL;
const password = process.env.WORKSPACE_BOOTSTRAP_PASSWORD;
assert.ok(canonical?.startsWith('https://'), 'CI must supply a synthetic canonical HTTPS origin');
assert.ok(email?.endsWith('.example.test') && password?.length >= 12, 'CI-only synthetic owner credentials are required');

function operator(args, input = '') {
  return spawnSync('docker', ['compose', '-f', 'infra/compose.yaml', '-f', 'infra/linux/compose.web.yaml', 'exec', '-T', ...args], {
    cwd: process.cwd(), input, encoding: 'utf8', timeout: 30000,
    env: process.env,
  });
}
function combined(result) { return `${result.stdout ?? ''}\n${result.stderr ?? ''}`; }

const missing = operator(['-e', 'WORKSPACE_AUTH_DATABASE=', '-e', 'BETTER_AUTH_SECRET=', 'web', 'node', '/srv/app/operator/workspace-auth-admin.mjs']);
assert.notEqual(missing.status, 0, 'missing configuration must fail closed');
assert.equal(combined(missing).includes(password), false, 'missing-config failure must not expose the password');

const input = `${email}\n${password}\n`;
const created = operator(['web', 'node', '/srv/app/operator/workspace-auth-admin.mjs'], input);
assert.equal(created.status, 0, 'owner bootstrap must run inside the production image against its mounted auth DB');
assert.match(created.stdout, /Owner created:/);
assert.equal(combined(created).includes(password), false, 'bootstrap output must not contain the password');

const login = await fetch(new URL('/api/workspace-auth/sign-in/email', base), {
  method: 'POST',
  headers: { origin: canonical, 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
assert.equal(login.status, 200, 'bootstrapped owner must authenticate through the live app');
const sessionCookie = login.headers.getSetCookie().map(value => value.split(';', 1)[0]).find(value => /session_token=/.test(value));
assert.ok(sessionCookie, 'login must set a real Better Auth session cookie');
const session = await fetch(new URL('/api/workspace-admin/session', base), { headers: { cookie: sessionCookie } });
assert.equal(session.status, 200);
const sessionBody = await session.json();
assert.deepEqual(sessionBody.user, { id: sessionBody.user.id, email, name: 'Workspace Owner', isOwner: true });
assert.equal(JSON.stringify(sessionBody).includes(sessionCookie.split('=')[1]), false, 'session endpoint must not expose raw tokens');

const repeated = operator(['web', 'node', '/srv/app/operator/workspace-auth-admin.mjs'], input);
assert.notEqual(repeated.status, 0, 'second bootstrap must refuse an existing owner');
assert.equal(combined(repeated).includes(password), false, 'refusal output must not expose the password');
process.stdout.write('Workspace owner bootstrap container acceptance passed.\n');
