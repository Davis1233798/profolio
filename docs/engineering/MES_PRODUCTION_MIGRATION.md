# MES production migration handoff

## Evidence and ownership

The independent MES release `e09c5bf` passed OCI deployment in
[GitHub Actions](https://github.com/Davis1233798/business-suite-mes/actions/runs/43134583115).
The public hostname still returns the shared Web health contract.
The MES operator owns source/target data reconciliation. The Portfolio operator
owns the Caddy mode and route rollback. Record the operator for each role
in the maintenance ticket before freezing writes.

## Staged rehearsal

1. Record the exact source and target revisions and approved organization IDs.
   Take consistent SQLite backups through their respective application backup
   commands. Record the snapshot digests and prove each opens in a separate
   recovery location.
2. Restore the approved source snapshot to a private rehearsal location. Run
   the independent MES repository's migration contract against that snapshot.
   Keep the source untouched and write output to a new candidate database.
3. Compare counts and representative business records per organization,
   including work orders, operations, reports, material movements, quality and
   finished goods. Verify station accounts, grants, the legacy report retry
   mapping, and the audit and outbox archive digests.
4. Start the pinned MES release against the candidate privately. Verify login,
   scoped data and labels, report retries, and one full production transaction
   sequence. Keep rehearsal artifacts outside Git.

## Production activation

1. Confirm the accepted rehearsal and freeze MES writes at the shared origin.
   Capture a fresh pair of backups and repeat import and reconciliation.
2. Activate the target with the independent MES operator. Verify its private
   health reports the intended SHA. Check the root-owned ingress socket and
   Go health as described in [MES public routing](MES_PUBLIC_ROUTE_CUTOVER.md).
3. Use the existing route cutover command to switch the MES hostname. Verify
   the public HTTPS Go readiness, revision, login and read-only datasets
   before reopening writes.
4. If any activation check fails before reopening writes, return the route to
   shared mode and resume the shared writer after verifying public health.
   After reopening writes, freeze both sides before rollback and reconcile
   target-only writes before resuming on the shared origin.

Current outstanding evidence includes the production snapshot rehearsal,
account enrollment checks, and the public route switch.
