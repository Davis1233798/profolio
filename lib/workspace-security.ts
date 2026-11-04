import { DatabaseSync } from "node:sqlite";
import { Kysely } from "kysely";
import { betterAuth } from "better-auth";
import { NodeSqliteDialect } from "@better-auth/kysely-adapter/node-sqlite-dialect";
import { admin } from "better-auth/plugins";
import { apiKey, defaultKeyHasher } from "@better-auth/api-key";
import { randomBytes } from "node:crypto";
import type { TenantContext } from "./tenant";

export class WorkspaceSecurityError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "WorkspaceSecurityError"; }
}
async function readJson<T>(request:Request):Promise<T> {
  const length=Number(request.headers.get("content-length")??0); if(length>8192) throw new WorkspaceSecurityError(413,"Request too large");
  const reader=request.body?.getReader(); if(!reader) return {} as T; const chunks:Uint8Array[]=[]; let size=0;
  try { while(true) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>8192) { await reader.cancel(); throw new WorkspaceSecurityError(413,"Request too large"); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))) as T; } catch { throw new WorkspaceSecurityError(400,"Invalid JSON"); }
}

export type WorkspaceSecurityConfig = { databasePath: string; baseURL: string; secret: string; googleClientId?:string; googleClientSecret?:string };
type SessionUser = { id: string; email: string; name: string; role?: string; banned?: boolean };

function validateConfig(config: WorkspaceSecurityConfig): void {
  if (!config.databasePath || !config.baseURL || !/^https:\/\//.test(config.baseURL) || Buffer.byteLength(config.secret) < 32) {
    throw new WorkspaceSecurityError(503, "Workspace authentication is not configured");
  }
}
function consumeLimit(runtime:ReturnType<typeof openWorkspaceSecurity>,subject:string,max:number,windowMs:number) {
  const window=Math.floor(Date.now()/windowMs); runtime.sqlite.exec("BEGIN IMMEDIATE");
  try { runtime.sqlite.prepare("INSERT INTO security_limits(subject,window,count) VALUES(?,?,1) ON CONFLICT(subject,window) DO UPDATE SET count=count+1").run(subject,window); const row=runtime.sqlite.prepare("SELECT count FROM security_limits WHERE subject=? AND window=?").get(subject,window) as {count:number}; if(row.count>max) throw new WorkspaceSecurityError(429,"Rate limit exceeded"); runtime.sqlite.exec("COMMIT"); }
  catch(error) { runtime.sqlite.exec("ROLLBACK"); throw error; }
}

export function openWorkspaceSecurity(config: WorkspaceSecurityConfig) {
  validateConfig(config);
  if(Boolean(config.googleClientId)!==Boolean(config.googleClientSecret)) throw new WorkspaceSecurityError(503,"Google authentication is partially configured");
  const sqlite = new DatabaseSync(config.databasePath);
  sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  const kysely = new Kysely({ dialect: new NodeSqliteDialect({ database: sqlite }) });
  const auth = betterAuth({
    baseURL: config.baseURL,
    basePath: "/api/workspace-auth",
    secret: config.secret,
    database: { db: kysely, type: 'sqlite', transaction: true },
    emailAndPassword: { enabled: true, minPasswordLength: 12, autoSignIn: false, disableSignUp: true },
    socialProviders: config.googleClientId&&config.googleClientSecret?{google:{clientId:config.googleClientId,clientSecret:config.googleClientSecret,disableImplicitSignUp:true,disableSignUp:true}}:{},
    account:{accountLinking:{enabled:true,trustedProviders:["google"],allowDifferentEmails:false,requireLocalEmailVerified:true}},
    plugins: [admin(), apiKey({ enableSessionForAPIKeys: false, disableKeyHashing: false, enableMetadata: true, keyExpiration: { minExpiresIn: 60 / 86400, maxExpiresIn: 30 } })],
    advanced: { useSecureCookies: true, defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: true } },
    session: { cookieCache: { enabled: false } },
    rateLimit: { enabled: true },
  });
  sqlite.exec(`CREATE TABLE IF NOT EXISTS workspace_memberships(user_id TEXT NOT NULL, workspace_id TEXT NOT NULL, permissions TEXT NOT NULL, PRIMARY KEY(user_id,workspace_id));
    CREATE TABLE IF NOT EXISTS security_audit(id INTEGER PRIMARY KEY, actor TEXT NOT NULL, event TEXT NOT NULL, target TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS security_limits(subject TEXT NOT NULL, window INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(subject,window));
    CREATE TABLE IF NOT EXISTS workspace_download_keys(key_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,workspace_id TEXT NOT NULL,scope TEXT NOT NULL,expires_at INTEGER NOT NULL,quota INTEGER,used INTEGER NOT NULL DEFAULT 0,revoked INTEGER NOT NULL DEFAULT 0);`);
  let ready: Promise<void> | undefined;
  const initialize = () => ready ??= auth.$context.then(context => context.runMigrations());

  async function getPrincipal(request: Request): Promise<SessionUser> {
    await initialize();
    const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
    if (!session?.user || (session.user as SessionUser).banned) throw new WorkspaceSecurityError(401, "Authentication required");
    return session.user as SessionUser;
  }
  function audit(actor: string, event: string, target: string) {
    sqlite.prepare("INSERT INTO security_audit(actor,event,target,created_at) VALUES(?,?,?,?)").run(actor,event,target,Date.now());
  }
  return {
    auth, sqlite, initialize, getPrincipal, audit, googleConfigured:Boolean(config.googleClientId&&config.googleClientSecret),
    async close() { await kysely.destroy(); },
  };
}

let production: ReturnType<typeof openWorkspaceSecurity> | undefined;
function getRuntime() {
  const config = { databasePath: process.env.WORKSPACE_AUTH_DATABASE ?? "", baseURL: process.env.BETTER_AUTH_URL ?? "", secret: process.env.BETTER_AUTH_SECRET ?? "",googleClientId:process.env.GOOGLE_CLIENT_ID,googleClientSecret:process.env.GOOGLE_CLIENT_SECRET };
  validateConfig(config);
  return production ??= openWorkspaceSecurity(config);
}

async function authHandler(request:Request,runtime:ReturnType<typeof openWorkspaceSecurity>,canonicalOrigin:string):Promise<Response> {
  const url = new URL(request.url);
  if(request.method==="GET"&&url.pathname==="/api/workspace-auth/providers") return Response.json({google:runtime.googleConfigured},{headers:{"cache-control":"no-store"}});
  if(request.method==="GET"&&url.pathname==="/api/workspace-auth/callback/google") {
    if(url.origin!==canonicalOrigin||!runtime.googleConfigured) throw new WorkspaceSecurityError(runtime.googleConfigured?403:503,"Google callback unavailable");
    await runtime.initialize(); return runtime.auth.handler(request);
  }
  if(request.method==="POST"&&url.pathname==="/api/workspace-auth/sign-in/social") {
    if(!runtime.googleConfigured) throw new WorkspaceSecurityError(503,"Google authentication is not configured");
    if(request.headers.get("origin")!==canonicalOrigin) throw new WorkspaceSecurityError(403,"Invalid origin");
    await runtime.initialize();
    const result=await runtime.auth.api.signInSocial({headers:request.headers,body:{provider:"google",callbackURL:`${canonicalOrigin}/admin/workspace`,requestSignUp:false,disableRedirect:true}});
    return Response.json(result,{headers:{"cache-control":"no-store"}});
  }
  const permitted = new Set(["/api/workspace-auth/sign-in/email", "/api/workspace-auth/sign-out", "/api/workspace-auth/change-password"]);
  if (!permitted.has(url.pathname) || (request.method !== "POST")) throw new WorkspaceSecurityError(404, "Not found");
  if (request.headers.get("origin") !== canonicalOrigin) throw new WorkspaceSecurityError(403, "Invalid origin");
  await runtime.initialize();
  if(url.pathname==="/api/workspace-auth/sign-in/email") {
    const ip=request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown"; consumeLimit(runtime,`login-ip:${ip}`,20,60000);
    const body=await request.clone().json().catch(()=>({})) as {email?:string}; if(body.email) consumeLimit(runtime,`login-email:${body.email.toLowerCase()}`,8,60000);
  }
  return runtime.auth.handler(request);
}
export async function handleWorkspaceAuth(request: Request): Promise<Response> { const runtime=getRuntime(); return authHandler(request,runtime,new URL(process.env.BETTER_AUTH_URL!).origin); }

async function management(request:Request,runtime:ReturnType<typeof openWorkspaceSecurity>,canonicalOrigin:string):Promise<Response> {
  await runtime.initialize();
  const url = new URL(request.url);
  const route = url.pathname.slice("/api/workspace-admin/".length);
  const actor = await runtime.getPrincipal(request);
  const isOwner = actor.role === "admin";
  if (route !== 'session' && route !== 'workspaces' && !isOwner) throw new WorkspaceSecurityError(403, "Owner required");
  if (request.method !== "GET" && request.headers.get("origin") !== canonicalOrigin) throw new WorkspaceSecurityError(403, "Invalid origin");
  if (request.method === "POST" && route === "users") {
    const body = await readJson<{ email?: string; password?: string; name?: string }>(request);
    if (!body.email || !body.password || body.password.length < 12 || !body.name) throw new WorkspaceSecurityError(400, "Invalid user details");
    const result = await runtime.auth.api.createUser({ headers: request.headers, body: { email: body.email, password: body.password, name: body.name, role: "user" } });
    runtime.audit(actor.id, "user.create", result.user.id);
    return Response.json({ user: { id: result.user.id, email: result.user.email, name: result.user.name } }, { status: 201, headers: { "cache-control": "no-store" } });
  }
  if (request.method === "POST" && route === "memberships") {
    const body = await readJson<{ userId?: string; workspaceId?: string; permissions?: string[] }>(request);
    const permissions = body.permissions ?? [];
    if (!body.userId || !body.workspaceId || !permissions.length || permissions.some(p => !["export", "restore"].includes(p))) throw new WorkspaceSecurityError(400, "Invalid workspace membership");
    if(!runtime.sqlite.prepare("SELECT 1 FROM user WHERE id=?").get(body.userId)) throw new WorkspaceSecurityError(404,"User not found");
    runtime.sqlite.prepare("INSERT INTO workspace_memberships(user_id,workspace_id,permissions) VALUES(?,?,?) ON CONFLICT(user_id,workspace_id) DO UPDATE SET permissions=excluded.permissions").run(body.userId,body.workspaceId,JSON.stringify([...new Set(permissions)]));
    runtime.audit(actor.id,"membership.grant",`${body.userId}:${body.workspaceId}`);
    return Response.json({ ok:true },{headers:{"cache-control":"no-store"}});
  }
  if(request.method==="DELETE"&&route==="memberships") {
    const body=await readJson<{userId?:string;workspaceId?:string}>(request); if(!body.userId||!body.workspaceId) throw new WorkspaceSecurityError(400,"Invalid workspace membership");
    runtime.sqlite.prepare("DELETE FROM workspace_memberships WHERE user_id=? AND workspace_id=?").run(body.userId,body.workspaceId);
    runtime.audit(actor.id,"membership.revoke",`${body.userId}:${body.workspaceId}`); return Response.json({ok:true},{headers:{"cache-control":"no-store"}});
  }
  if (request.method === "POST" && route === "keys") {
    const body = await readJson<{ userId?:string; workspaceId?:string; scope?:{kind:string;datasets?:string[]}; expiresInSeconds?:number; quota?:number }>(request);
    if (!body.userId||!body.workspaceId||!body.scope||!Number.isInteger(body.expiresInSeconds)||body.expiresInSeconds! < 60||body.expiresInSeconds! > 2592000|| (body.quota!==undefined&&(!Number.isInteger(body.quota)||body.quota<1||body.quota>100000))) throw new WorkspaceSecurityError(400,"Invalid key request");
    if (body.scope.kind!=="json" && (body.scope.kind!=="csv"||!body.scope.datasets?.length||body.scope.datasets.some(x=>!DATASETS.has(x)))) throw new WorkspaceSecurityError(400,"Invalid key scope");
    if(body.scope.kind==="json"&&body.scope.datasets?.length) throw new WorkspaceSecurityError(400,"Invalid key scope");
    const grant=runtime.sqlite.prepare("SELECT permissions FROM workspace_memberships WHERE user_id=? AND workspace_id=?").get(body.userId,body.workspaceId) as {permissions:string}|undefined;
    if(!runtime.sqlite.prepare("SELECT 1 FROM user WHERE id=?").get(body.userId)) throw new WorkspaceSecurityError(404,"User not found");
    if(!grant||!JSON.parse(grant.permissions).includes("export")) throw new WorkspaceSecurityError(403,"Export membership required");
    const created:any=await runtime.auth.api.createApiKey({body:{userId:body.userId,name:`workspace:${body.workspaceId}`,expiresIn:body.expiresInSeconds,remaining:body.quota??null,metadata:{workspaceId:body.workspaceId,scope:body.scope}}} as never);
    runtime.sqlite.prepare("INSERT INTO workspace_download_keys(key_id,user_id,workspace_id,scope,expires_at,quota) VALUES(?,?,?,?,?,?)").run(created.id,body.userId,body.workspaceId,JSON.stringify(body.scope),Date.now()+body.expiresInSeconds!*1000,body.quota??null);
    runtime.audit(actor.id,"key.issue",created.id);
    return Response.json({id:created.id,secret:created.key,userId:body.userId,workspaceId:body.workspaceId,scope:body.scope,expiresAt:Date.now()+body.expiresInSeconds!*1000},{status:201,headers:{"cache-control":"no-store"}});
  }
  if (request.method === "DELETE" && route === "keys") {
    const body=await readJson<{keyId?:string}>(request); if(!body.keyId) throw new WorkspaceSecurityError(400,"Missing key ID");
    runtime.sqlite.exec("BEGIN IMMEDIATE");
    try { const key=runtime.sqlite.prepare("SELECT user_id FROM workspace_download_keys WHERE key_id=?").get(body.keyId) as {user_id:string}|undefined; if(!key) throw new WorkspaceSecurityError(404,"Key not found"); runtime.sqlite.prepare("UPDATE workspace_download_keys SET revoked=1 WHERE key_id=?").run(body.keyId); runtime.sqlite.prepare("UPDATE apikey SET enabled=0 WHERE id=?").run(body.keyId); runtime.audit(actor.id,"key.revoke",body.keyId); runtime.sqlite.exec("COMMIT"); } catch(e) { runtime.sqlite.exec("ROLLBACK"); throw e; }
    return Response.json({ok:true},{headers:{"cache-control":"no-store"}});
  }
  if (request.method === "GET" && route === "session") return Response.json({user:{id:actor.id,email:actor.email,name:actor.name,isOwner:actor.role==="admin"}},{headers:{"cache-control":"no-store"}});
  if (request.method === "GET" && route === "workspaces") return Response.json({workspaces:runtime.sqlite.prepare("SELECT workspace_id AS id,permissions FROM workspace_memberships WHERE user_id=?").all(actor.id).map((r:any)=>({...r,permissions:JSON.parse(r.permissions)}))},{headers:{"cache-control":"no-store"}});
  if (request.method === "GET" && route === "users" && isOwner) return Response.json({users:runtime.sqlite.prepare("SELECT id,email,name,banned FROM user ORDER BY email").all()},{headers:{"cache-control":"no-store"}});
  if (request.method === "GET" && route === "keys" && isOwner) return Response.json({keys:runtime.sqlite.prepare("SELECT key_id AS id,user_id AS userId,workspace_id AS workspaceId,scope,expires_at AS expiresAt,revoked,CASE WHEN quota IS NULL THEN NULL ELSE max(0,quota-used) END AS remaining FROM workspace_download_keys ORDER BY rowid DESC").all().map((k:any)=>({...k,scope:JSON.parse(k.scope),enabled:!k.revoked,revoked:undefined}))},{headers:{"cache-control":"no-store"}});
  if (request.method === "GET" && route === "audit" && isOwner) return Response.json({events:runtime.sqlite.prepare("SELECT id,actor,event,target,created_at AS createdAt FROM security_audit ORDER BY id DESC LIMIT 100").all()},{headers:{"cache-control":"no-store"}});
  if(request.method==="POST"&&route==="users/suspend") { const body=await readJson<{userId?:string}> (request); if(!body.userId||body.userId===actor.id) throw new WorkspaceSecurityError(400,"Invalid user"); runtime.sqlite.prepare("UPDATE user SET banned=1 WHERE id=?").run(body.userId); runtime.audit(actor.id,"user.suspend",body.userId); return Response.json({ok:true},{headers:{"cache-control":"no-store"}}); }
  if(request.method==="POST"&&route==="users/restore") { const body=await readJson<{userId?:string}> (request); if(!body.userId) throw new WorkspaceSecurityError(400,"Invalid user"); runtime.sqlite.prepare("UPDATE user SET banned=0 WHERE id=?").run(body.userId); runtime.audit(actor.id,"user.restore",body.userId); return Response.json({ok:true},{headers:{"cache-control":"no-store"}}); }
  throw new WorkspaceSecurityError(404,"Not found");
}
export async function handleWorkspaceManagement(request: Request): Promise<Response> { const runtime=getRuntime(); await runtime.initialize(); return management(request,runtime,new URL(process.env.BETTER_AUTH_URL!).origin); }

export const WORKSPACE_EXPORT_DATASETS=new Set(["pos_sales","pos_catalog_items","erp_items","crm_contacts","mes_work_orders","dining_orders","shop_orders"]);
const DATASETS=WORKSPACE_EXPORT_DATASETS;
export async function authorizeWorkspaceExport(request: Request, dataset?: string): Promise<TenantContext> {
  return authorizeWorkspaceExportForTest(request,dataset,getRuntime(),new URL(process.env.BETTER_AUTH_URL!).origin);
}
// Explicit runtime injection is used by synthetic integration tests and production alike.
export async function authorizeWorkspaceExportForTest(request:Request,dataset:string|undefined,runtime:ReturnType<typeof openWorkspaceSecurity>,canonicalOrigin:string):Promise<TenantContext> {
  const user=await runtime.getPrincipal(request); const url=new URL(request.url); const workspaceId=url.searchParams.get("workspaceId"); const secret=request.headers.get("x-workspace-download-key");
  if(request.headers.get("origin") && request.headers.get("origin")!==canonicalOrigin) throw new WorkspaceSecurityError(403,"Invalid origin");
  if(!workspaceId||!secret) throw new WorkspaceSecurityError(401,"Workspace and download key required");
  if(dataset&&!DATASETS.has(dataset)) throw new WorkspaceSecurityError(403,"Dataset is not exportable");
  const ip=request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown"; consumeLimit(runtime,`export-ip:${ip}`,120,60000); consumeLimit(runtime,`export-user:${user.id}`,40,60000);
  // Check ownership before the plugin verifies/consumes its key-level quota.
  const ownedKey = runtime.sqlite.prepare('SELECT k.scope FROM workspace_download_keys k JOIN apikey a ON a.id=k.key_id WHERE a.key=? AND k.user_id=? AND k.workspace_id=? AND k.revoked=0 AND k.expires_at>?').get(await defaultKeyHasher(secret), user.id, workspaceId, Date.now()) as { scope: string } | undefined;
  if (!ownedKey) throw new WorkspaceSecurityError(403, 'Invalid download key');
  const requestedScope = JSON.parse(ownedKey.scope) as { kind: string; datasets?: string[] };
  if ((!dataset && requestedScope.kind !== 'json') || (dataset && (requestedScope.kind !== 'csv' || !requestedScope.datasets?.includes(dataset)))) throw new WorkspaceSecurityError(403, 'Key does not permit this export format');
  const verified:any=await runtime.auth.api.verifyApiKey({body:{key:secret}} as never);
  if(!verified.valid||!verified.key||verified.key.referenceId!==user.id||verified.key.metadata?.workspaceId!==workspaceId) throw new WorkspaceSecurityError(403,"Invalid download key");
  const db=runtime.sqlite; db.exec("BEGIN IMMEDIATE");
  try {
    const key=db.prepare("SELECT * FROM workspace_download_keys WHERE key_id=? AND user_id=? AND workspace_id=?").get(verified.key.id,user.id,workspaceId) as any;
    const membership=db.prepare("SELECT permissions FROM workspace_memberships WHERE user_id=? AND workspace_id=?").get(user.id,workspaceId) as {permissions:string}|undefined;
    const scope=key&&JSON.parse(key.scope);
    if(!key||key.revoked||key.expires_at<=Date.now()||(key.quota!==null&&key.used>=key.quota)||!membership||!JSON.parse(membership.permissions).includes("export")||(!dataset&&scope.kind!=="json")||(dataset&&(scope.kind!=="csv"||!scope.datasets.includes(dataset)))) throw new WorkspaceSecurityError(403,"Workspace export denied");
    const requestId = randomBytes(12).toString('hex');
    db.prepare("UPDATE workspace_download_keys SET used=used+1 WHERE key_id=?").run(key.key_id);
    runtime.audit(user.id, 'export.authorize', JSON.stringify({ workspaceId, keyId: key.key_id, requestId }));
    db.exec("COMMIT");
    return {organizationId:workspaceId,userId:user.id,userEmail:user.email,userDisplayName:user.name,role:"admin" as const,requestId};
  } catch(e) { db.exec("ROLLBACK"); throw e; }
}
export async function requireWorkspaceRestoreAccess(request: Request): Promise<TenantContext> {
  return authorizeWorkspaceRestore(request, getRuntime(), new URL(process.env.BETTER_AUTH_URL!).origin);
}
export async function authorizeWorkspaceRestore(request: Request, runtime: ReturnType<typeof openWorkspaceSecurity>, canonicalOrigin: string): Promise<TenantContext> {
  const user=await runtime.getPrincipal(request); const url=new URL(request.url); const workspaceId=url.searchParams.get("workspaceId");
  if(request.headers.get("origin")!==canonicalOrigin) throw new WorkspaceSecurityError(403,"Invalid origin");
  if(user.role!=="admin"||!workspaceId) throw new WorkspaceSecurityError(403,"Owner and workspace required");
  const membership=runtime.sqlite.prepare("SELECT permissions FROM workspace_memberships WHERE user_id=? AND workspace_id=?").get(user.id,workspaceId) as {permissions:string}|undefined;
  if(!membership||!JSON.parse(membership.permissions).includes("restore")) throw new WorkspaceSecurityError(403,"Restore membership required");
  if(request.method==="HEAD") return {organizationId:workspaceId,userId:user.id,userEmail:user.email,userDisplayName:user.name,role:"admin",requestId:randomBytes(12).toString("hex")};
  const hour=Math.floor(Date.now()/3600000); runtime.sqlite.exec("BEGIN IMMEDIATE");
  try { runtime.sqlite.prepare("INSERT INTO security_limits(subject,window,count) VALUES(?,?,1) ON CONFLICT(subject,window) DO UPDATE SET count=count+1").run(`restore:${user.id}`,hour); const used=runtime.sqlite.prepare("SELECT count FROM security_limits WHERE subject=? AND window=?").get(`restore:${user.id}`,hour) as {count:number}; if(used.count>5) throw new WorkspaceSecurityError(429,"Restore rate limit exceeded"); runtime.audit(user.id,"restore.authorize",workspaceId); runtime.sqlite.exec("COMMIT"); }
  catch(e) { runtime.sqlite.exec("ROLLBACK"); throw e; }
  return {organizationId:workspaceId,userId:user.id,userEmail:user.email,userDisplayName:user.name,role:"admin",requestId:randomBytes(12).toString("hex")};
}
export async function verifyWorkspaceRestorePassword(request: Request, password: string): Promise<void> {
  return confirmWorkspacePassword(request, password, getRuntime());
}
export async function confirmWorkspacePassword(request: Request, password: string, runtime: ReturnType<typeof openWorkspaceSecurity>): Promise<void> {
  if(typeof password!=="string"||password.length<12) throw new WorkspaceSecurityError(401,"Credential confirmation failed");
  const access=await runtime.getPrincipal(request);
  try { await runtime.auth.api.verifyPassword({ headers: request.headers, body: { password } }); }
  catch { throw new WorkspaceSecurityError(401,"Credential confirmation failed"); }
  const workspaceId=new URL(request.url).searchParams.get("workspaceId")!;
  runtime.audit(access.id,"restore.password_confirmed",workspaceId);
}
export async function recordWorkspaceTransfer(context:TenantContext,operation:"export"|"restore",outcome:"success"|"failure",metadata:Record<string,string|number|boolean|null>={}) {
  const runtime=getRuntime(); const safeMetadata=Object.fromEntries(Object.entries(metadata).filter(([key,value])=>!/key|secret|password|token|cookie|body/i.test(key)&&["string","number","boolean"].includes(typeof value)||value===null));
  runtime.audit(context.userId,`workspace.${operation}.${outcome}`,`${context.organizationId}:${context.requestId}:${JSON.stringify(safeMetadata).slice(0,512)}`);
}

// Synthetic test factory shares the same file-backed SQLite and Better Auth handlers.
export async function createWorkspaceSecurityForTest(config: WorkspaceSecurityConfig & { owner?: { email: string; password: string } }) {
  const runtime = openWorkspaceSecurity(config);
  await runtime.initialize();
  if (config.owner) {
    const existing = runtime.sqlite.prepare("SELECT id FROM user WHERE role='admin' LIMIT 1").get();
    if (!existing) {
      await runtime.auth.api.createUser({ body: { email: config.owner.email, password: config.owner.password, name: "Synthetic Owner", role: "admin" } });
    }
  }
  return {
    auth: runtime.auth,
    runtime,
    async request(path: string, init: RequestInit = {}) {
      const request = new Request(new URL(path, config.baseURL), init);
      try {
        if (new URL(request.url).pathname.startsWith("/api/workspace-auth/")) return await authHandler(request,runtime,new URL(config.baseURL).origin);
        if (new URL(request.url).pathname.startsWith("/api/workspace-admin/")) return await management(request,runtime,new URL(config.baseURL).origin);
        return Response.json({error:"Not found"},{status:404});
      } catch(error) {
        if(error instanceof WorkspaceSecurityError) return Response.json({error:error.message},{status:error.status});
        throw error;
      }
    },
    async close() { await runtime.close(); },
  };
}
