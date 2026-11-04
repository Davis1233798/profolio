import { DatabaseSync } from "node:sqlite";
import { Kysely } from "kysely";
import { betterAuth } from "better-auth";
import { NodeSqliteDialect } from "@better-auth/kysely-adapter/node-sqlite-dialect";
import { admin } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { randomBytes } from "node:crypto";

export class WorkspaceSecurityError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "WorkspaceSecurityError"; }
}

export type WorkspaceSecurityConfig = { databasePath: string; baseURL: string; secret: string };
type SessionUser = { id: string; email: string; name: string; role?: string; banned?: boolean };

function validateConfig(config: WorkspaceSecurityConfig): void {
  if (!config.databasePath || !config.baseURL || !/^https:\/\//.test(config.baseURL) || Buffer.byteLength(config.secret) < 32) {
    throw new WorkspaceSecurityError(503, "Workspace authentication is not configured");
  }
}

export function openWorkspaceSecurity(config: WorkspaceSecurityConfig) {
  validateConfig(config);
  const sqlite = new DatabaseSync(config.databasePath);
  sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  const kysely = new Kysely({ dialect: new NodeSqliteDialect({ database: sqlite }) });
  const auth = betterAuth({
    baseURL: config.baseURL,
    secret: config.secret,
    database: kysely,
    emailAndPassword: { enabled: true, minPasswordLength: 12, autoSignIn: false },
    plugins: [admin(), apiKey({ enableSessionForAPIKeys: false, disableKeyHashing: false })],
    advanced: { useSecureCookies: true, defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: true } },
    rateLimit: { enabled: true },
  });
  sqlite.exec(`CREATE TABLE IF NOT EXISTS workspace_memberships(user_id TEXT NOT NULL, workspace_id TEXT NOT NULL, permissions TEXT NOT NULL, PRIMARY KEY(user_id,workspace_id));
    CREATE TABLE IF NOT EXISTS security_audit(id INTEGER PRIMARY KEY, actor TEXT NOT NULL, event TEXT NOT NULL, target TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS security_limits(subject TEXT NOT NULL, window INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(subject,window));`);
  let ready: Promise<void> | undefined;
  const initialize = () => ready ??= auth.$context.then(context => context.runMigrations());

  async function getPrincipal(request: Request): Promise<SessionUser> {
    await initialize();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user || (session.user as SessionUser).banned) throw new WorkspaceSecurityError(401, "Authentication required");
    return session.user as SessionUser;
  }
  function audit(actor: string, event: string, target: string) {
    sqlite.prepare("INSERT INTO security_audit(actor,event,target,created_at) VALUES(?,?,?,?)").run(actor,event,target,Date.now());
  }
  return {
    auth, sqlite, initialize, getPrincipal, audit,
    async close() { await kysely.destroy(); sqlite.close(); },
  };
}

let production: ReturnType<typeof openWorkspaceSecurity> | undefined;
function getRuntime() {
  const config = { databasePath: process.env.WORKSPACE_AUTH_DATABASE ?? "", baseURL: process.env.BETTER_AUTH_URL ?? "", secret: process.env.BETTER_AUTH_SECRET ?? "" };
  validateConfig(config);
  return production ??= openWorkspaceSecurity(config);
}

export async function handleWorkspaceAuth(request: Request): Promise<Response> {
  const runtime = getRuntime();
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/workspace-auth/")) throw new WorkspaceSecurityError(404, "Not found");
  await runtime.initialize();
  return runtime.auth.handler(request);
}

export async function handleWorkspaceManagement(request: Request): Promise<Response> {
  const runtime = getRuntime();
  await runtime.initialize();
  const actor = await runtime.getPrincipal(request);
  if (actor.role !== "admin") throw new WorkspaceSecurityError(403, "Owner required");
  if (request.method !== "POST" || new URL(request.url).pathname !== "/api/workspace-admin/users") throw new WorkspaceSecurityError(404, "Not found");
  if (request.headers.get("origin") !== runtime.auth.options.baseURL) throw new WorkspaceSecurityError(403, "Invalid origin");
  const body = await request.json() as { email?: string; password?: string; name?: string };
  if (!body.email || !body.password || body.password.length < 12 || !body.name) throw new WorkspaceSecurityError(400, "Invalid user details");
  const result = await runtime.auth.api.createUser({ headers: request.headers, body: { email: body.email, password: body.password, name: body.name, role: "user" } });
  runtime.audit(actor.id, "user.create", result.user.id);
  return Response.json({ user: { id: result.user.id, email: result.user.email, name: result.user.name } }, { status: 201, headers: { "cache-control": "no-store" } });
}

export async function authorizeWorkspaceExport(_request: Request, _dataset?: string): Promise<never> {
  getRuntime(); throw new WorkspaceSecurityError(401, "Workspace export authorization required");
}
export async function requireWorkspaceRestoreAccess(_request: Request): Promise<never> {
  getRuntime(); throw new WorkspaceSecurityError(401, "Workspace restore authorization required");
}
export async function verifyWorkspaceRestorePassword(_request: Request, _password: string): Promise<never> {
  getRuntime(); throw new WorkspaceSecurityError(401, "Credential confirmation required");
}

// Synthetic test factory shares the same file-backed SQLite and Better Auth handlers.
export async function createWorkspaceSecurityForTest(config: WorkspaceSecurityConfig & { owner?: { email: string; password: string } }) {
  const runtime = openWorkspaceSecurity(config);
  await runtime.initialize();
  if (config.owner) {
    const existing = runtime.sqlite.prepare("SELECT id FROM user WHERE role='admin' LIMIT 1").get();
    if (!existing) {
      await runtime.auth.api.signUpEmail({ body: { email: config.owner.email, password: config.owner.password, name: "Synthetic Owner" } });
      const row = runtime.sqlite.prepare("SELECT id FROM user WHERE email=?").get(config.owner.email) as { id: string } | undefined;
      if (!row) throw new WorkspaceSecurityError(500, "Synthetic owner bootstrap failed");
      runtime.sqlite.prepare("UPDATE user SET role='admin' WHERE id=?").run(row.id);
    }
  }
  return {
    auth: runtime.auth,
    async request(path: string, init: RequestInit = {}) { return runtime.auth.handler(new Request(new URL(path, config.baseURL), init)); },
    async close() { await runtime.close(); },
  };
}
