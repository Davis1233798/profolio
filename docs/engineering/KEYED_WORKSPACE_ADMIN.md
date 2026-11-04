# Authenticated workspace administration and owner-issued export keys

## Architecture

Replace the public portfolio backup panel with `/admin/workspace`, reached through a small administration link. Use pinned Better Auth 1.7.16, its Drizzle SQLite adapter and API-key plugin. Authentication users, sessions and keys are distinct from the browser-selected demo roles and organization UUID. Disable public signup, API-key-as-session support and user-controlled key issuance. No default public administrator or shared demo password is provisioned.

The owner bootstraps the first administrator through a local operator command against the server database; password input is private stdin, never command arguments, repository files or logs. Auth secrets/base URL must be explicitly configured; missing configuration fails closed. Administrators create/invite individual accounts and grant explicit workspace membership. The stable server user ID identifies an account across devices. Neither IP, device fingerprint, browser UUID nor a typed email alone proves identity. Shared accounts cannot distinguish separate people.

Only an authenticated owner administrator can issue or revoke download keys. A key binds one user ID, one organization/workspace ID, an allowlisted export scope (JSON backup or selected CSV datasets), an expiry and optional quota. Secret material is returned once, stored hashed by the API-key plugin, and supplied through a request header alongside the valid login session. A key cannot create a session; possession alone is insufficient. Another user's key, another workspace, expired/revoked keys and unauthorized CSV tables must fail. No keys in URLs, logs, localStorage or public seed data. The UI accepts a pasted key or a local key file into memory, clears it on logout, and uses authenticated fetch-to-Blob downloads rather than secret-bearing anchors.

Restore is a separate permission: only an authenticated administrator with explicit workspace restore authorization can invoke it, with recent credential confirmation and a destructive-action confirmation. A download key never grants restore. Preserve existing tenant row validation, auth/audit exclusions and atomic rollback. Existing anonymous endpoints must fail before seeding a workspace, reading business data or buffering a restore body.

## Boundaries

Use the real server session to resolve user and memberships on every protected request; do not build authority from `demo_session_id`, `demo_user_role`, requested organization IDs or client flags. Recheck account suspension, membership removal and key revocation immediately (disable session cache for authorization). Explicit membership allows selecting an existing legacy workspace; knowing its UUID alone does not grant access. Keep authentication, membership, key, rate-limit and security-audit tables outside tenant backup/export/restore manifests.

Apply durable per-account/key endpoint limits and login/IP limits before expensive exports/restores; shared process restarts must not reset quotas. Same-origin/CSRF checks are required for state changes. Requests/exports have byte and row bounds, authentication responses are no-store, cookie attributes are secure/HttpOnly/SameSite, and audit events record actor/target/key ID/outcome without secrets. Do not expose generic Better Auth admin/key creation endpoints that bypass the owner wrapper or workspace grants. Do not enable impersonation or public signup/reset flows without an actual delivery/verification design.

## Tests before implementation

Remote synthetic SQLite integration tests must prove: anonymous/fake demo-admin requests are rejected; individual real accounts and secure sessions work; suspended/revoked sessions fail; only the owner issues keys; user B cannot use user A's key even with a valid session; workspace/table scope, expiry, revocation, quota and rate limits are enforced; API keys alone cannot log in; auth tables never appear in a backup; unauthorized restore cannot alter rows; valid restore is transactional and preserves auth/audit; invalid origin and oversized bodies fail. Fresh/upgrade migrations must preserve existing data.

Chromium acceptance covers actual admin login, account/grant/key issuance, one-time secret presentation, key-file/paste downloads, logout invalidation, clear denied states and both portfolio languages. Use generated CI-only credentials and test workspaces; no real keys or user data in artifacts. No local application tests/builds.

## Deployment acceptance

Merge reviewed changes only after remote CI. Configure the private auth secret and owner bootstrap outside source control, then verify public legacy export/restore requests deny access, authenticated per-user keyed downloads succeed, cross-user access fails and revocation is immediate. Owner bootstrap is an operator step, not an automatic public signup. This work does not claim migrated production identities or physical-person verification from demo cookies.
