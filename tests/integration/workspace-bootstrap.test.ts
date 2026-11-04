import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('owner bootstrap reads private piped credentials after initialization and refuses a second owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-bootstrap-'));
  const password = 'Synthetic-bootstrap-password-9931';
  const execute = () => new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), 'scripts/workspace-auth-admin.ts'], {
      env: { ...process.env, WORKSPACE_AUTH_DATABASE: join(directory, 'auth.sqlite'), BETTER_AUTH_URL: 'https://portfolio.example.test', BETTER_AUTH_SECRET: 'synthetic-bootstrap-secret-at-least-32-bytes' },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    let output = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Synthetic bootstrap timed out')); }, 30_000);
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', code => { clearTimeout(timeout); resolveRun({ code, output }); });
    child.stdin.on('error', () => {}); // The second bootstrap can refuse before stdin is consumed.
    child.stdin.end(`owner@example.test\n${password}\n`);
  });
  try {
    const first = await execute();
    assert.equal(first.code, 0, first.output.replaceAll(password, '[redacted]'));
    assert.match(first.output, /Owner created:/);
    assert.equal(first.output.includes(password), false, 'password must never be printed');
    const second = await execute();
    assert.equal(second.code, 1);
    assert.match(second.output, /already exists/);
    assert.equal(second.output.includes(password), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
