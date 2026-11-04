# Private workspace access

This feature uses individual Better Auth accounts and a private authentication database. Demo role cookies do not authorize the administration API. The owner creates accounts, grants access to existing workspace IDs, and issues expiring download keys tied to a particular account/workspace/scope.

## Configuration

Set `BETTER_AUTH_URL=https://blockchen.duckdns.org` and a random `BETTER_AUTH_SECRET` of at least 32 bytes in the host's private environment configuration. Never commit either an owner password or a download key. `WORKSPACE_AUTH_DATABASE` is `/srv/app/.auth/workspace-auth.sqlite` in the portfolio container; the `workspace-auth-data` volume is mounted only by that runtime. Missing configuration denies access. An empty configuration must never silently create an owner.

Bootstrap the first owner with `scripts/workspace-auth-admin.ts` in the checked-out release/operator environment after installing the locked dependencies. Supply the email and strong password as two newline-separated values through a private stdin pipe from a password manager or an equivalent secret source. The command refuses an interactive terminal to prevent password echo and refuses if an owner already exists. Do not put the password in command arguments, shell history, environment examples or logs. This operator command is not reachable from the public website. Do not run it with a temporary database and assume that creates a production owner.

## Owner workflow

1. Visit `/admin/workspace` and sign in with the bootstrapped account.
2. Create a separate account for each person. Its immutable account ID is the authorization subject; the same account can log in from another device. A shared account cannot identify separate people.
3. Grant the account access to the intended existing workspace ID. Possessing or typing a workspace UUID alone does not grant access.
4. Issue a key for that account and workspace. Choose JSON backup or a permitted CSV dataset, expiry and download quota. The raw secret is shown once; record it in your password manager and deliver it privately to its assigned user.
5. The user signs in and pastes the key or reads a small text key file. The browser holds it in memory and sends it in a header; it never goes into the URL or browser persistent storage.
6. Revoke a key to stop future downloads. Remove workspace access or suspend an account to withdraw its authorization. Audit records identify the acting account and key ID without recording secrets.

Restore is separate: it requires an owner account, explicit restore membership, current-password confirmation and a selected same-workspace backup. A download key grants no restore ability. Authentication/authorization/audit data are not restorable business data. Keep the private auth database and its operational backup procedure separate from public workspace exports.

## Verification and limits

Before enabling production access, remote tests must demonstrate unauthenticated rejection, real login, cross-user key denial, scope enforcement, expiry/revocation/quota and durable limits, CSRF rejection, bounded input/output and transactional restore. Check the real OCI endpoints after deployment. A green build or a rendered login form does not establish that production identity/key issuance is configured. No production owner or download key has been created by adding these files.
