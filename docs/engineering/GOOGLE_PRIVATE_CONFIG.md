# Private Google OAuth client configuration

## Architecture and boundaries

Provide a Linux operator-only importer for the Google Cloud Web client JSON. Read it through bounded private stdin, never HTTP or command arguments. Validate the Web client type, client ID, nonempty secret and the exact callback derived from the already-configured BETTER_AUTH_URL. Preserve the existing auth secret and all unrelated infrastructure configuration. Missing/malformed credentials, unsafe paths or a callback mismatch must leave the original environment file unchanged.

The target must be an existing regular, non-symlink, single-link private file (0600) owned by the operator or operated on by root; its parent must not be writable by other users. Write via a 0600 temporary file in that directory, fsync and atomic replace, preserving ownership. Require an explicit --replace flag to rotate existing Google credentials. Print success/failure without credential values. Do not restart services or create an owner. Apply configuration through the reviewed GitHub deployment pipeline afterwards.

Docker Compose quoting must preserve opaque secret characters, including dollar signs, quotes and backslashes. Use real Compose parsing in remote tests; never assume that source-file text equals the final container environment. Documentation: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/

## Tests before implementation

Remote infra unittest coverage runs the real stdin CLI with synthetic credentials. Check successful import, unrelated-line/auth-secret preservation, private permissions and silent output; reject desktop-client JSON, wrong callback, oversized input, newline values, symlink/public target and accidental rotation without changing the file. A Docker Compose config round trip must preserve the complete synthetic opaque secret. No local tests/builds or real credentials in CI artifacts.

## Operator acceptance

User creates a Web OAuth client in their own Google Cloud project and retains its downloaded JSON privately. Import over SSH stdin into the host-private environment, then use GitHub deployment and verify real Google sign-in for the initialized invited owner. Import and synthetic tests do not establish real Google authentication success.