import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspaceSecurityForTest, authorizeWorkspaceExportForTest } from "../../lib/workspace-security";

const secret = "synthetic-ci-only-secret-value-at-least-32-bytes";
const ownerEmail = "owner@example.test";
const ownerPassword = "CI-only-owner-password-9931";

test("private SQLite Better Auth runtime uses actual login cookies and owner-only account creation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "workspace-security-"));
  const security = await createWorkspaceSecurityForTest({
    databasePath: join(dir, "auth.sqlite"), baseURL: "https://portfolio.example.test", secret,
    owner: { email: ownerEmail, password: ownerPassword },
  });
  try {
    const signup = await security.request("/api/workspace-auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "public@example.test", password: "CI-public-password-9931", name: "Public" }) });
    assert.equal(signup.ok, false, "public signup is disabled");

    const signIn = await security.request("/api/workspace-auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json", origin:"https://portfolio.example.test" }, body: JSON.stringify({ email: ownerEmail, password: ownerPassword }) });
    assert.equal(signIn.ok, true);
    const cookie = signIn.headers.get("set-cookie");
    assert.ok(cookie?.includes("better-auth.session_token"), "sign in sets the real Better Auth session cookie");
    const cookieHeader = cookie!.split(";")[0];
    const session = await security.request("/api/workspace-admin/session", { headers: { cookie: cookieHeader } });
    assert.equal(session.status, 200);
    const sessionBody = await session.json() as any;
    assert.equal(sessionBody.user.email, ownerEmail);
    assert.equal(JSON.stringify(sessionBody).includes(cookieHeader.split("=")[1]), false, "session response does not reveal token");

    const created = await security.request("/api/workspace-admin/users", { method: "POST", headers: { cookie: cookieHeader, origin: "https://portfolio.example.test", "content-type": "application/json" }, body: JSON.stringify({ email: "alice@example.test", password: "CI-user-A-password-9931", name: "Alice" }) });
    assert.equal(created.status, 201);
    const createdBody = await created.json() as any;
    assert.equal(createdBody.user.email, "alice@example.test");
    assert.equal(JSON.stringify(createdBody).includes("password"), false);
    const aliceId=createdBody.user.id;

    const userLogin = await security.request("/api/workspace-auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json", origin:"https://portfolio.example.test" }, body: JSON.stringify({ email: "alice@example.test", password: "CI-user-A-password-9931" }) });
    assert.equal(userLogin.ok, true);
    const userCookie = userLogin.headers.get("set-cookie")!.split(";")[0];
    const membership=await security.request("/api/workspace-admin/memberships",{method:"POST",headers:{cookie:cookieHeader,origin:"https://portfolio.example.test","content-type":"application/json"},body:JSON.stringify({userId:aliceId,workspaceId:"workspace-a",permissions:["export"]})});
    assert.equal(membership.status, 200);
    const previousBusinessPath = process.env.SUITE_SQLITE_PATH;
    process.env.SUITE_SQLITE_PATH = join(dir, "legacy-mes.sqlite");
    const business = new DatabaseSync(process.env.SUITE_SQLITE_PATH);
    try {
      business.exec(`
        CREATE TABLE mes_work_orders (id TEXT, organization_id TEXT, order_no TEXT);
        CREATE TABLE mes_production_reports (
          id TEXT, organization_id TEXT, operator_id TEXT, work_order_id TEXT,
          good_quantity INTEGER, scrap_quantity INTEGER, report_time TEXT, notes TEXT
        );
        INSERT INTO mes_work_orders VALUES ('order-a','workspace-a','WO-1');
        INSERT INTO mes_production_reports VALUES ('report-a','workspace-a','legacy-a','order-a',2,0,'2026-01-01','note');
      `);
      const target = { userId: aliceId, workspaceId: "workspace-a" };
      const route = "/api/workspace-admin/legacy-mes-history";
      const query = new URLSearchParams(target);
      assert.equal((await security.request(`${route}?${query}`, { headers: { cookie: userCookie } })).status, 403);
      const mutate = (method: string, body: object, origin = "https://portfolio.example.test") =>
        security.request(route, { method, headers: { cookie: cookieHeader, origin, "content-type": "application/json" }, body: JSON.stringify(body) });
      assert.equal((await mutate("POST", { ...target, operatorId: "legacy-a" }, "https://other.example.test")).status, 403);
      const linked = await mutate("POST", { ...target, operatorId: "legacy-a" });
      assert.equal(linked.status, 200);
      assert.equal((await linked.json() as { reports: unknown[] }).reports.length, 1);
      assert.equal((await mutate("DELETE", { ...target, confirmUserId: "wrong-user" })).status, 400);
      const cleared = await mutate("DELETE", { ...target, confirmUserId: aliceId });
      assert.equal(cleared.status, 200);
      assert.deepEqual((await cleared.json() as { reports: unknown[] }).reports, []);
      const retained = business.prepare("SELECT operator_id, notes, good_quantity FROM mes_production_reports").get();
      assert.equal(retained?.operator_id, "");
      assert.equal(retained?.notes, null);
      assert.equal(retained?.good_quantity, 2);
    } finally {
      business.close();
      if (previousBusinessPath === undefined) delete process.env.SUITE_SQLITE_PATH;
      else process.env.SUITE_SQLITE_PATH = previousBusinessPath;
    }

    assert.equal(membership.ok,true);
    const keyResponse=await security.request("/api/workspace-admin/keys",{method:"POST",headers:{cookie:cookieHeader,origin:"https://portfolio.example.test","content-type":"application/json"},body:JSON.stringify({userId:aliceId,workspaceId:"workspace-a",scope:{kind:"csv",datasets:["pos_sales"]},expiresInSeconds:600,quota:2})});
    assert.equal(keyResponse.status,201);
    const key=await keyResponse.json() as any;
    const listed = await security.request('/api/workspace-admin/keys', { headers: { cookie: cookieHeader } });
    assert.equal(JSON.stringify(await listed.json()).includes(key.secret), false, 'raw key is never returned by list');
    const stored = security.runtime.sqlite.prepare('SELECT key FROM apikey WHERE id=?').get(key.id) as { key: string };
    assert.notEqual(stored.key, key.secret, 'only a hash of the secret is persisted');
    const exportRequest=(cookieValue:string,keyValue:string,url="/api/workspace/export?workspaceId=workspace-a")=>new Request(new URL(url,"https://portfolio.example.test"),{headers:{cookie:cookieValue,"x-workspace-download-key":keyValue,origin:"https://portfolio.example.test"}});
    const permitted=await authorizeWorkspaceExportForTest(exportRequest(userCookie,key.secret,"/api/workspace/export?workspaceId=workspace-a&table=pos_sales"),"pos_sales",security.runtime,"https://portfolio.example.test");
    assert.equal(permitted.userId,aliceId);
    const audit = await security.request('/api/workspace-admin/audit', { headers: { cookie: cookieHeader } });
    const history = JSON.stringify(await audit.json());
    assert.equal(history.includes(key.id), true, 'audit identifies the issued/redeemed key by non-secret ID');
    assert.equal(history.includes(key.secret), false, 'audit must not contain the raw key');
    await assert.rejects(authorizeWorkspaceExportForTest(exportRequest(userCookie,key.secret),undefined,security.runtime,"https://portfolio.example.test"),{status:403},"CSV keys cannot authorize full JSON export");
    await assert.rejects(authorizeWorkspaceExportForTest(exportRequest(cookieHeader,key.secret,"/api/workspace/export?workspaceId=workspace-a&table=pos_sales"),"pos_sales",security.runtime,"https://portfolio.example.test"),{status:403},"owner cannot redeem another user's key");
    const revoke=await security.request("/api/workspace-admin/keys",{method:"DELETE",headers:{cookie:cookieHeader,origin:"https://portfolio.example.test","content-type":"application/json"},body:JSON.stringify({keyId:key.id})});
    assert.equal(revoke.ok,true);
    await assert.rejects(authorizeWorkspaceExportForTest(exportRequest(userCookie,key.secret,"/api/workspace/export?workspaceId=workspace-a&table=pos_sales"),"pos_sales",security.runtime,"https://portfolio.example.test"),{status:403},"revoked key is denied immediately");
    const denied = await security.request("/api/workspace-admin/users", { method: "POST", headers: { cookie: userCookie, origin: "https://portfolio.example.test", "content-type": "application/json" }, body: JSON.stringify({ email: "b@example.test", password: "CI-user-B-password-9931", name: "B" }) });
    assert.equal(denied.status, 403, "ordinary users cannot create accounts");
    for (const action of ['users/suspend', 'users/restore', 'memberships', 'keys']) {
      const denied = await security.request(`/api/workspace-admin/${action}`, { method: 'POST', headers: { cookie: userCookie, origin: 'https://portfolio.example.test', 'content-type': 'application/json' }, body: JSON.stringify({ userId: sessionBody.user.id }) });
      assert.equal(denied.status, 403, `ordinary user cannot call ${action}`);
    }
    const csrf = await security.request('/api/workspace-admin/users/suspend', { method: 'POST', headers: { cookie: cookieHeader, origin: 'https://attacker.example.test', 'content-type': 'application/json' }, body: JSON.stringify({ userId: aliceId }) });
    assert.equal(csrf.status, 403);

    async function issue(quota: number) {
      const response = await security.request('/api/workspace-admin/keys', { method: 'POST', headers: { cookie: cookieHeader, origin: 'https://portfolio.example.test', 'content-type': 'application/json' }, body: JSON.stringify({ userId: aliceId, workspaceId: 'workspace-a', scope: { kind: 'csv', datasets: ['pos_sales'] }, expiresInSeconds: 600, quota }) });
      assert.equal(response.status, 201);
      return await response.json() as { id: string; secret: string };
    }
    const singleUse = await issue(1);
    await authorizeWorkspaceExportForTest(exportRequest(userCookie, singleUse.secret), 'pos_sales', security.runtime, 'https://portfolio.example.test');
    await assert.rejects(authorizeWorkspaceExportForTest(exportRequest(userCookie, singleUse.secret), 'pos_sales', security.runtime, 'https://portfolio.example.test'), { status: 403 }, 'download quota cannot be exceeded');
    const expired = await issue(10);
    security.runtime.sqlite.prepare('UPDATE workspace_download_keys SET expires_at=? WHERE key_id=?').run(Date.now() - 1000, expired.id);
    await assert.rejects(authorizeWorkspaceExportForTest(exportRequest(userCookie, expired.secret), 'pos_sales', security.runtime, 'https://portfolio.example.test'), { status: 403 }, 'expired workspace grant is denied');
    const foreign = await issue(10);
    const remainingBefore = security.runtime.sqlite.prepare('SELECT remaining FROM apikey WHERE id=?').get(foreign.id) as { remaining: number };
    await assert.rejects(authorizeWorkspaceExportForTest(exportRequest(cookieHeader, foreign.secret), 'pos_sales', security.runtime, 'https://portfolio.example.test'), { status: 403 });
    const remainingAfter = security.runtime.sqlite.prepare('SELECT remaining FROM apikey WHERE id=?').get(foreign.id) as { remaining: number };
    assert.equal(remainingAfter.remaining, remainingBefore.remaining, 'another account must not consume the key owner download quota');
    await assert.rejects(authorizeWorkspaceExportForTest(exportRequest(userCookie, foreign.secret, '/api/workspace/export?workspaceId=workspace-b'), 'pos_sales', security.runtime, 'https://portfolio.example.test'), { status: 403 }, 'key cannot select another workspace');
    const jsonOnlyResponse = await security.request('/api/workspace-admin/keys', { method: 'POST', headers: { cookie: cookieHeader, origin: 'https://portfolio.example.test', 'content-type': 'application/json' }, body: JSON.stringify({ userId: aliceId, workspaceId: 'workspace-a', scope: { kind: 'json' }, expiresInSeconds: 600, quota: 10 }) });
    assert.equal(jsonOnlyResponse.status, 201);
    const jsonOnly = await jsonOnlyResponse.json() as { secret: string };
    await assert.rejects(authorizeWorkspaceExportForTest(exportRequest(userCookie, jsonOnly.secret), 'pos_sales', security.runtime, 'https://portfolio.example.test'), { status: 403 }, 'JSON-only key cannot select CSV format');
    const keyOnly = await security.request('/api/workspace-admin/session', { headers: { 'x-workspace-download-key': foreign.secret, 'x-api-key': foreign.secret } });
    assert.equal(keyOnly.status, 401, 'a key cannot create an authenticated session');

    const fake = await security.request("/api/workspace-admin/session", { headers: { cookie: "demo_user_role=admin; demo_session_id=forged" } });
    assert.equal(fake.status, 401, "demo cookies do not create a Better Auth session");
  } finally {
    await security.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing canonical auth configuration fails closed", async () => {
  await assert.rejects(createWorkspaceSecurityForTest({ databasePath: ":memory:", baseURL: "", secret: "short" }), { status: 503 });
});
