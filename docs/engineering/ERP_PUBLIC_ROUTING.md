# ERP public routing

Caddy can reach the independent ERP service through the host's
`/run/erp-ingress/upstream.sock`. A Compose overlay mounts only that directory
read-only. The existing ERP hostname continues to use the shared service
until its upstream is changed during cutover.

Before activating the overlay and upstream together, verify the imported
data and user access in the independent ERP. Check the public login,
anonymous rejection, and matching ERP revision immediately after cutover.
Rollback restores the shared upstream and removes the overlay. Reconcile
any writes accepted by the independent ERP before reopening shared writes.

## Rehearse and verify

From the active release's infra directory, use the current Compose project
name, shared environment file and existing MES overlay. Append
`-f linux/compose.erp-rootless-route.yaml` to that same Compose invocation.
Use `config --quiet` to check the combined configuration without printing
the environment. On the host, confirm the private endpoint before any edge
recreation:

```sh
sudo curl --fail --silent --show-error --unix-socket /run/erp-ingress/upstream.sock http://localhost/api/health
```

To apply the rehearsed route, recreate only the edge service with
`up -d --no-deps --force-recreate edge`. To revert it, recreate edge using
the original file list. Persist ERP_PUBLIC_ROUTE=rootless in the shared environment to retain the overlay on subsequent releases. Set ERP_PUBLIC_ROUTE=shared before recreating edge to restore the shared route.
