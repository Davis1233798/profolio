import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkspaceSecurityForTest } from "../../lib/workspace-security";

const baseURL="https://portfolio.example.test";
const secret="synthetic-google-oidc-test-secret-32-bytes-minimum";

test("Google provider is unavailable when either server credential is missing", async()=>{
  const dir=await mkdtemp(join(tmpdir(),"workspace-google-"));
  const security=await createWorkspaceSecurityForTest({databasePath:join(dir,"auth.sqlite"),baseURL,secret});
  try {
    const response=await security.request("/api/workspace-auth/providers");
    assert.equal(response.status,200); assert.deepEqual(await response.json(),{google:false});
    const start=await security.request("/api/workspace-auth/sign-in/social",{method:"POST",headers:{origin:baseURL,"content-type":"application/json"},body:JSON.stringify({provider:"google"})});
    assert.equal(start.status,503);
  } finally { await security.close(); await rm(dir,{recursive:true,force:true}); }
  await assert.rejects(createWorkspaceSecurityForTest({databasePath:":memory:",baseURL,secret,googleClientId:"partial-client-id"}),{status:503});
});

test("Google social start fixes provider and callback and ignores injected OAuth authority",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"workspace-google-"));
  const security=await createWorkspaceSecurityForTest({databasePath:join(dir,"auth.sqlite"),baseURL,secret,googleClientId:"synthetic-client-id.apps.googleusercontent.com",googleClientSecret:"synthetic-client-secret"});
  try {
    const response=await security.request("/api/workspace-auth/sign-in/social",{method:"POST",headers:{origin:baseURL,"content-type":"application/json"},body:JSON.stringify({provider:"attacker",requestSignUp:true,callbackURL:"https://attacker.test/steal",redirectTo:"https://attacker.test",idToken:{token:"forged"}})});
    assert.equal(response.status,200);
    const data=await response.json() as any;
    const authorization=new URL(data.url);
    assert.equal(authorization.hostname,"accounts.google.com");
    assert.equal(authorization.searchParams.get("redirect_uri"),`${baseURL}/api/workspace-auth/callback/google`);
    assert.ok(authorization.searchParams.has("state"));
    assert.ok(authorization.searchParams.has("code_challenge"));
    assert.ok(response.headers.getSetCookie().length > 0, 'state/PKCE cookies must reach the browser');
    assert.equal(data.url.includes("attacker"),false);

    const invalid=await security.request("/api/workspace-auth/callback/google?state=forged&code=synthetic");
    assert.ok(invalid.status >= 400 || (invalid.status >= 300 && invalid.status < 400), 'invalid state must not return a successful login');
    if (invalid.headers.has('location')) assert.equal(new URL(invalid.headers.get('location')!, baseURL).origin, baseURL);
    assert.equal(invalid.headers.getSetCookie().some(cookie => cookie.includes('session_token=')), false);
    const fakeSession=await security.request("/api/workspace-admin/session",{headers:{cookie:"demo_user_role=admin; demo_session_id=forged"}});
    assert.equal(fakeSession.status,401);
    const signup=await security.request("/api/workspace-auth/sign-up/email",{method:"POST",headers:{origin:baseURL,"content-type":"application/json"},body:JSON.stringify({email:"attacker@example.test",password:"synthetic-password-123",name:"Attacker"})});
    assert.ok(signup.status>=400);
  } finally { await security.close(); await rm(dir,{recursive:true,force:true}); }
});
