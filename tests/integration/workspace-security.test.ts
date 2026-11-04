import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspaceSecurityForTest } from "../../lib/workspace-security";

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
    const signup = await security.request("/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "public@example.test", password: "CI-public-password-9931", name: "Public" }) });
    assert.equal(signup.ok, false, "public signup is disabled");

    const signIn = await security.request("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: ownerEmail, password: ownerPassword }) });
    assert.equal(signIn.ok, true);
    const cookie = signIn.headers.get("set-cookie");
    assert.ok(cookie?.includes("better-auth.session_token"), "sign in sets the real Better Auth session cookie");
    const cookieHeader = cookie!.split(";")[0];
    const session = await security.request("/api/auth/get-session", { headers: { cookie: cookieHeader } });
    assert.equal(session.status, 200);
    const sessionBody = await session.json() as any;
    assert.equal(sessionBody.user.email, ownerEmail);
    assert.equal(JSON.stringify(sessionBody).includes(cookieHeader.split("=")[1]), false, "session response does not reveal token");

    const created = await security.request("/api/workspace-admin/users", { method: "POST", headers: { cookie: cookieHeader, origin: "https://portfolio.example.test", "content-type": "application/json" }, body: JSON.stringify({ email: "alice@example.test", password: "CI-user-A-password-9931", name: "Alice" }) });
    assert.equal(created.status, 201);
    const createdBody = await created.json() as any;
    assert.equal(createdBody.user.email, "alice@example.test");
    assert.equal(JSON.stringify(createdBody).includes("password"), false);

    const userLogin = await security.request("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "alice@example.test", password: "CI-user-A-password-9931" }) });
    assert.equal(userLogin.ok, true);
    const userCookie = userLogin.headers.get("set-cookie")!.split(";")[0];
    const denied = await security.request("/api/workspace-admin/users", { method: "POST", headers: { cookie: userCookie, origin: "https://portfolio.example.test", "content-type": "application/json" }, body: JSON.stringify({ email: "b@example.test", password: "CI-user-B-password-9931", name: "B" }) });
    assert.equal(denied.status, 403, "ordinary users cannot create accounts");

    const fake = await security.request("/api/auth/get-session", { headers: { cookie: "demo_user_role=admin; demo_session_id=forged" } });
    assert.equal(await fake.json(), null, "demo cookies do not create a Better Auth session");
  } finally {
    await security.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing canonical auth configuration fails closed", async () => {
  await assert.rejects(createWorkspaceSecurityForTest({ databasePath: ":memory:", baseURL: "", secret: "short" }), { status: 503 });
});
