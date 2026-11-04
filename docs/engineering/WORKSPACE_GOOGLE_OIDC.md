# Google OAuth 2.0 / OpenID Connect

## Architecture and boundary

Use the pinned Better Auth Google provider for authorization-code sign-in, token exchange, state/PKCE and provider identity validation. Accounts remain server-owned: only the operator bootstrap/owner creates them. Google sign-in does not open public registration or assign administrator privileges. An invited existing account can link a verified Google identity with the same email; subsequent identity uses the provider's stable subject/account ID. Never trust an email, role or provider subject supplied directly by the browser.

The owner supplied an account email privately in chat; configure/create that account outside Git. Do not hard-code the real email, client secret, owner password or tokens in this public repository. Google configuration comes from `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the portfolio runtime only. The canonical callback is `/api/workspace-auth/callback/google` on `BETTER_AUTH_URL`. Missing or partial provider configuration must not pretend Google authentication is available.

Expose only a Google-capability GET, fixed Google social-start POST and the Google GET callback in addition to the existing scoped password/logout operations. The social start discards caller-supplied ID tokens, provider, signup flags and callback/redirect destinations; construct a fixed request for Google and `/admin/workspace`. Disable implicit and explicit provider signup. Callback has no mutation-origin requirement because it returns from Google, but requires the canonical host and the authentication library's valid state/PKCE flow. No custom token verification or callback state bypass.

Google sign-in establishes only account identity. Every download still needs a live session, current workspace grant and matching owner-issued export key. Existing restore authorization remains separate. Do not enable API-key sessions or trust demo cookies. The password fallback and private operator bootstrap remain available while Google credentials are being configured; Google tokens are never displayed in the dashboard or stored in browser localStorage.

## Tests before implementation

Remote synthetic tests verify provider-unconfigured denial, configured start returning only an accounts.google.com authorization URL with the exact callback, rejection of caller-controlled provider/signup/redirect/ID-token fields, invalid callback state producing no authenticated session, and no public signup. Existing real account/key/restore tests remain. These tests verify integration boundaries; only a real Google console client and interactive sign-in can prove live Google authentication.

## Activation

Register a Web OAuth client in the owner's Google Cloud project, configure the exact authorized callback and publish/test-user policy, and supply credentials privately to OCI. Create/verify the owner account through the private operator procedure, then complete real Google login and verify its stable provider subject, account role, logout and revocation. Do not request the client secret in chat or commit it. Live provider verification remains pending until these settings exist.
