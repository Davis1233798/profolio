import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, validSession } from "./lib/tenant";
import { seedOrganization } from "./lib/seed";
import { getDb } from "./db";
import { demoSeedStates } from "./db/schema";
import { eq } from "drizzle-orm";
const seeding = new Map<string, Promise<unknown>>();
export async function middleware(request: NextRequest) {
  // Container probes must not create a fresh tenant, seed data or Outbox events.
  if (request.nextUrl.pathname === '/api/health') return NextResponse.next();
  // Real account/key administration never inherits demo roles or seeds visitors.
  const path = request.nextUrl.pathname;
  if (path === '/admin/workspace' || path.startsWith('/api/workspace-auth/') || path.startsWith('/api/workspace-admin/') || path === '/api/workspace/backup' || path === '/api/workspace/export') return NextResponse.next();
  const previous = request.cookies.get(SESSION_COOKIE)?.value;
  const session = validSession(previous) ? previous : crypto.randomUUID();
  const org = `org_${session}`;
  const headers = new Headers(request.headers);
  const cookies = (headers.get("cookie") || "").split(";").filter(value => !value.trim().startsWith(`${SESSION_COOKIE}=`));
  headers.set("cookie", [...cookies, `${SESSION_COOKIE}=${session}`].filter(Boolean).join("; "));
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const exists = await getDb().select({ id: demoSeedStates.organizationId }).from(demoSeedStates).where(eq(demoSeedStates.organizationId, org)).limit(1);
    if (!exists.length || seeding.has(org)) {
      let pending = seeding.get(org);
      if (!pending) { pending = seedOrganization(org).finally(() => seeding.delete(org)); seeding.set(org, pending); }
      await pending;
    }
  }
  const response = NextResponse.next({ request: { headers } });
  if (session !== previous) response.cookies.set(SESSION_COOKIE, session, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 604800 });
  return response;
}
export const config = { matcher: ["/((?!_next|favicon.ico|signin-with-chatgpt|signout-with-chatgpt|callback).*)"] };
