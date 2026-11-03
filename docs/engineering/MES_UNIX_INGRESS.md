# MES ingress on the existing OCI host

## Architecture

Web runs on the existing OCI host. Central Caddy remains in its rootful Docker daemon; MES runs in the separate mes-runtime rootless daemon, publishing only 127.0.0.1:18095. Docker networks cannot cross these daemons. A host systemd socket proxies a fixed Unix socket to that loopback port. Caddy receives only a read-only mount of the socket directory; it receives no MES database, runtime home, Docker socket or deployment credential.

## Boundaries

The new allowlisted route mode is `rootless`; `shared` remains the default and the existing `isolated` mode remains compatible. Its upstream is fixed to `unix//run/mes-ingress/upstream.sock`. Root owns the socket directory and socket; the current Caddy image uses UID 0. A future non-root Caddy must receive an explicitly reviewed group grant. The systemd proxy runs unprivileged with no filesystem write or application-data access. No public port is added. Host provisioning installs the units separately; application deployment does not grant either MES account host control.

Before route mutation or main deployment, verify root ownership, directory/socket modes, no symlink path, and ready Go health through the Unix socket. Route cutover shares the central deploy lock and reuses the existing public HTTPS check and route-only rollback. The transport does not prove MES authentication, database migration or browser acceptance; these remain separate release gates. Rollback to shared must work even when MES or the proxy is down.

## Tests before implementation

Add remote unit tests for the fixed rootless enum, unsafe path/ownership/mode rejection and valid socket acceptance. Add a GitHub Linux integration test with a real TCP upstream, systemd-socket-proxyd and a Caddy container using the read-only Unix socket mount; prove request forwarding, upstream outage, and restored forwarding. Existing shared/isolated routing regression tests remain enabled. Do not run local application tests.

## Release acceptance

Install and verify the units on OCI, deploy the rootless MES service, verify health/revision, authentication/authorization, non-MES route denial, persistence and rollback, then explicitly cut over the public hostname. A merged implementation or green CI alone does not mean this cutover happened.
