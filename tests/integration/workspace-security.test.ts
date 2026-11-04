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
    assert.equal(membership.ok,true);
    const keyResponse=await security.request("/api/workspace-admin/keys",{method:"POST",headers:{cookie:cookieHeader,origin:"https://portfolio.example.test","content-type":"application/json"},body:JSON.stringify({userId:aliceId,workspaceId:"workspace-a",scope:{kind:"csv",datasets:["pos_sales"]},expiresInSeconds:600,quota:2})});
    assert.equal(keyResponse.status,201);
    const key=await keyResponse.json() as any;
    const exportRequest=(cookieValue:string,keyValue:string,url="/api/workspace/export?workspaceId=workspace-a")=>new Request(new URL(url,"https://portfolio.example.test"),{headers:{cookie:cookieValue,"x-workspace-download-key":keyValue,origin:"https://portfolio.example.test"}});
    const permitted=await authorizeWorkspaceExportForTest(exportRequest(userCookie,key.secret,"/api/workspace/export?workspaceId=workspace-a&table=pos_sales"),"pos_sales",security.runtime,"https://portfolio.example.test");
    assert.equal(permitted.userId,aliceId);
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
