import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";
import { openWorkspaceSecurity, WorkspaceSecurityError } from "../lib/workspace-security";

const config = {
  databasePath: process.env.WORKSPACE_AUTH_DATABASE ?? "",
  baseURL: process.env.BETTER_AUTH_URL ?? "",
  secret: process.env.BETTER_AUTH_SECRET ?? "",
};
const input = createInterface({ input: stdin, crlfDelay: Infinity });
let store: ReturnType<typeof openWorkspaceSecurity> | undefined;
try {
  store = openWorkspaceSecurity(config);
  await store.initialize();
  const existing = store.sqlite.prepare("SELECT id FROM user WHERE role='admin' LIMIT 1").get();
  if (existing) throw new Error("An owner administrator already exists; bootstrap refused.");
  const email = (await input.question("Owner email: ")).trim();
  const password = await input.question("Owner password (private stdin): ");
  if (!email || password.length < 12) throw new Error("A valid email and a password of at least 12 characters are required.");
  const created = await store.auth.api.createUser({ body: { email, password, name: "Workspace Owner", role: "admin" } });
  store.audit(created.user.id, "owner.bootstrap", created.user.id);
  stdout.write(`Owner created: ${created.user.id}\n`);
} catch (error) {
  stderr.write(`${error instanceof WorkspaceSecurityError ? error.message : error instanceof Error ? error.message : "Bootstrap failed"}\n`);
  process.exitCode = 1;
} finally {
  input.close();
  if (store) await store.close();
}
