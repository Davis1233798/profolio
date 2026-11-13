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
