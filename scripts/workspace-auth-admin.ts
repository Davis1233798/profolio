import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";
import { openWorkspaceSecurity, WorkspaceSecurityError } from "../lib/workspace-security";

const config = {
  databasePath: process.env.WORKSPACE_AUTH_DATABASE ?? "",
  baseURL: process.env.BETTER_AUTH_URL ?? "",
  secret: process.env.BETTER_AUTH_SECRET ?? "",
};
let input: ReturnType<typeof createInterface> | undefined;
let store: ReturnType<typeof openWorkspaceSecurity> | undefined;
try {
  store = openWorkspaceSecurity(config);
  if (stdin.isTTY) throw new Error("Bootstrap password must be piped through private stdin; interactive terminal input is refused to prevent echo.");
  await store.initialize();
  if (stdin.isTTY) throw new Error("Bootstrap password must be piped through private stdin; interactive terminal input is refused to prevent echo.");
  const existing = store.sqlite.prepare("SELECT id FROM user WHERE role='admin' LIMIT 1").get();
  if (existing) throw new Error("An owner administrator already exists; bootstrap refused.");
  input = createInterface({ input: stdin, crlfDelay: Infinity });
  const values: string[] = [];
  for await (const line of input) { if (line.length > 512 || values.length >= 2) throw new Error("Expected exactly two bounded input lines"); values.push(line); }
  const email = (values[0] || "").trim();
  const password = values[1] || "";
  if (!email || password.length < 12) throw new Error("A valid email and a password of at least 12 characters are required.");
  const created = await store.auth.api.createUser({ body: { email, password, name: "Workspace Owner", role: "admin" } });
  store.audit(created.user.id, "owner.bootstrap", created.user.id);
  stdout.write(`Owner created: ${created.user.id}\n`);
} catch (error) {
  stderr.write(`${error instanceof WorkspaceSecurityError ? error.message : error instanceof Error ? error.message : "Bootstrap failed"}\n`);
  process.exitCode = 1;
} finally {
  input?.close();
  if (store) await store.close();
}
