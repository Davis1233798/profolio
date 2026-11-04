import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspaceSecurityForTest } from "../../lib/workspace-security";

// Synthetic SQLite only: no production HTTP bypass and no credentials from the host.
test("workspace security isolates identities, scoped one-time keys, revocation and restore", async () => {
  const dir = await mkdtemp(join(tmpdir(), "workspace-security-"));
  const security = await createWorkspaceSecurityForTest({
    databasePath: join(dir, "auth.sqlite"),
    baseURL: "https://portfolio.example.test",
    secret: "synthetic-ci-secret-that-is-at-least-32-bytes-long",
    owner: { email: "owner@example.test", password: "CI-only-owner-password-9931" },
  });
  try {
    const ownerSession = await security.login("owner@example.test", "CI-only-owner-password-9931");
    const userA = await security.createUser(ownerSession, { email: "a@example.test", password: "CI-user-A-password-9931", name: "A" });
    const userB = await security.createUser(ownerSession, { email: "b@example.test", password: "CI-user-B-password-9931", name: "B" });
    await security.grantWorkspace(ownerSession, userA.id, "workspace-a", ["export"]);
    await security.grantWorkspace(ownerSession, userB.id, "workspace-a", ["export"]);
    const issued = await security.issueDownloadKey(ownerSession, { userId: userA.id, workspaceId: "workspace-a", scope: { kind: "csv", datasets: ["pos_catalog_items"] }, expiresInSeconds: 600, quota: 2 });
    assert.ok(issued.secret);
    assert.equal(issued.secretPresentedOnce, true);
    const sessionA = await security.login("a@example.test", "CI-user-A-password-9931");
    const sessionB = await security.login("b@example.test", "CI-user-B-password-9931");
    assert.equal((await security.authorizeExport(sessionA, "workspace-a", issued.secret, "pos_catalog_items")).userId, userA.id);
    await assert.rejects(security.authorizeExport(sessionB, "workspace-a", issued.secret, "pos_catalog_items"), { status: 403 });
    await assert.rejects(security.authorizeExport(sessionA, "workspace-a", issued.secret, "crm_contacts"), { status: 403 });
    await assert.rejects(security.authorizeExport(null, "workspace-a", issued.secret, "pos_catalog_items"), { status: 401 });
    await assert.rejects(security.authorizeExport(null, "workspace-a", null, "pos_catalog_items"), { status: 401 });
    await security.revokeKey(ownerSession, issued.id);
    await assert.rejects(security.authorizeExport(sessionA, "workspace-a", issued.secret, "pos_catalog_items"), { status: 403 });

    const restoreToken = await security.requireRestore(sessionA, "workspace-a", "https://portfolio.example.test");
    await assert.rejects(security.restoreWithPassword(restoreToken, "wrong password", async () => assert.fail("restore callback must not run")), { status: 401 });
    await security.suspendUser(ownerSession, userA.id);
    await assert.rejects(security.requireRestore(sessionA, "workspace-a", "https://portfolio.example.test"), { status: 401 });
    assert.equal((await security.listBackupTables()).includes("workspace_memberships"), false);
  } finally {
    await security.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing canonical auth configuration fails closed", async () => {
  await assert.rejects(createWorkspaceSecurityForTest({ databasePath: ":memory:", baseURL: "", secret: "short" }), { status: 503 });
});
