# Legacy MES records in Portfolio administration

## Record ownership

The shared Portfolio database is the source for legacy MES history. A report is
attributed by its organization and operator ID. A work order belongs to an
organization and has no creator column. Reports can associate an order with
several operators. An order without a report requires separate ownership
evidence before it can be displayed as personal history.

## Administration boundary

Portfolio workspace authentication gates history and deletion. Establish the
mapping between the Portfolio account and the legacy MES operator within the
same workspace before showing counts or records. Apply this constraint again
inside the write transaction. Require owner authorization and explicit target
confirmation for deletion. Preserve shared orders when other operators still
have records or downstream references. Keep the deletion audit limited to
actor, target, scope, and counts.

## Local acceptance

Cover anonymous and unauthorized access, the same operator ID in different
organizations, orders shared by two operators, orders lacking attribution,
and transaction rollback. Verify that clearing one user removes only that
user's report attribution and notes. Preserve production totals, linked operational records and replay guards. Check that old records
remain available until the owner clears them and that the public independent
MES is unaffected.

## Identity mapping

Portfolio authentication stores its principal IDs and workspace memberships
in the workspace security database. MES reports store legacy operator IDs in
the business database. A workspace membership proves access to a workspace
only. A link must identify the Portfolio principal, legacy organization, and
legacy operator explicitly. An email match alone cannot establish the link.
Use the existing owner and canonical-origin checks for any administrative
mutation and rate-limit the operation through the workspace security layer.
