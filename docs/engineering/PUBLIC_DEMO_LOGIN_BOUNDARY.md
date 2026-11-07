# Public station login availability

The public station login receives connections from Caddy. The current Go
limiter keys on the socket peer and email, so visitors choosing the same demo
role share one 20-attempt budget per 15 minutes behind that proxy. A failed
sign-in also initializes a fixture workspace before checking credentials.

## Program boundaries

- Caddy overwrites a station-only client-address header from its actual socket
  peer, never from a request header. The Go station accepts exactly one valid
  bare IP from that header only when the socket peer matches the configured
  Compose edge service address. Resolve the service name with a bounded lookup
  so container recreation can change the address. Direct, unconfigured,
  malformed or unresolved requests use the canonical socket peer; they cannot
  select their rate-limit key. Never log or persist raw visitor addresses.
- Enable this trust only in the public station Compose service. Preserve direct
  Windows, CI and standalone behavior. Do not change private workspace auth,
  public session/cookie formats, role grants, or the reverse proxy path.
- Key the existing rate limit on the verified IP and normalized email. Enforce
  the update and decision atomically, with the existing duration and per-account
  limit. Use a bounded per-IP attempt limit as well, so rotating emails cannot
  evade throttling. Return a generic failure for invalid credentials.
- Only a valid published demo credential can create a new demo workspace. For
  an existing workspace, authenticate against its stored account and grants;
  never reseed it to recover a disabled account or accept a static credential
  in place of its stored password. Do not expose which workspace/account exists.
- Preserve tenant isolation and the current rate limits for protected exports.
  This iteration does not promise production capacity or implement workspace
  expiry. Addressing by IP is a rate-limit signal, not a visitor identity.

## Remote acceptance

1. Behind the same trusted edge peer, two simulated client addresses choosing
   the same role each get an independent budget. Exhaustion returns 429 for
   one without blocking the other, even when cookies and email case vary.
2. Untrusted peers, missing/duplicate/invalid headers, and edge DNS failure
   cannot escape the socket peer limit. IPv4 and IPv6 are parsed consistently.
3. Invalid credentials for a fresh workspace create no fixture rows, cookies,
   or sessions. A valid demo creates its tenant; an existing custom account
   still works, while a disabled or changed-password account remains denied.
4. Exercise the actual Caddy Compose route from two isolated test clients and
   show that an injected client-address header is overwritten. No public
   traffic or production data is used for exhaustion tests. Run these checks
   in GitHub CI before treating the boundary as implemented.

References: [Caddy proxy header handling](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers),
[Caddy request placeholders](https://caddyserver.com/docs/caddyfile/concepts#placeholders),
and [Compose service discovery](https://docs.docker.com/compose/how-tos/networking/).
