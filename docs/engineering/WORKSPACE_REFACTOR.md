# Workspace refactor — 2026-10-31

The portfolio has no global navigation strip. Its system links open station login pages. Station workspaces no longer have a top account header; switching systems always opens the selected system login, including when that system has an existing session. Sign-out remains available in the sidebar on desktop and mobile.

Login defaults to English and supports Traditional Chinese. The explicit choice is stored in `suite-language` and initializes the station document language, labels, printing and traffic workbench. Existing business record content is not translated.

MES and commerce back-office pages include an isolated load workbench. It issues 48–512 real HTTP writes with 4–32 concurrent clients. Finite capacity, repeated request keys, SQL transactions and persisted queued/processed records demonstrate oversell/over-report protection and idempotent consumption. The queue is manually drained. The lab uses dedicated SQLite tables and never changes operational orders or production reports. SQLite has one connection; this is a contention/correctness demonstration, not a production throughput benchmark or distributed message broker.

Verification: `npm test`, `go -C backend test ./...`, `npx tsc --noEmit`, `npm run build`, `npm run web:build`, and `python scripts/verify-traffic-http.py`. The HTTP verifier uses a disposable database and checks both domains, capacity saturation, retries, queue consumption and readonly denial. Browser QA covers login, language persistence, switching back to login, a commerce burst and consumer results.

These are local repository changes. Public deployments require both the station Go binary/static bundle and the portfolio build to be updated together.


## Go workstation transaction progress

The Go station now supports MES BOM version creation with cycle checks, material lot creation/issue, BOM staging checks, work-order start, production reporting, quality checks and downtime recording; ERP stock transfers and purchase order submission/approval/receipt, sales shipments and purchase returns with moving-average costing, demo invoice payments and balanced journals/trial balance; POS open/close shift, multi-item cash sales, held-cart claim/release and administrator refund; CRM lead creation/conversion, opportunity stage changes, follow-up activities, versioned quote approval, opt-in contact consent and support tickets with Taipei business-hour SLA; dining table opening, multi-item dine-in and prepaid demo takeout orders with modifiers, split bill settlement, reservations, item voids, demo takeout refunds, kitchen ticket transitions and urgent flags; and multi-variant commerce checkout, simulated payment and shipment, shipped-order returns and verified-purchaser reviews. Transactions use the authenticated station organization and enforce role checks, idempotency and atomic inventory guards. The Go station database remains distinct from the legacy Node demo database. Other business workflows are not yet migrated; the Go station must not be described as feature-equivalent to the Node suite.

Commerce reservations expire after 15 minutes, and a station worker releases expired unpaid inventory. Simulated payment writes an outbox event transactionally. When the internal gateway is configured, the station retries publishing that event to the existing RabbitMQ fulfillment service; the downstream PostgreSQL consumer deduplicates events. Gateway acceptance is not confirmation of physical shipment. `scripts/verify-station-outbox.py` verifies this path against an isolated Compose stack in CI; mock gateway unit tests verify retry and tenant mapping.

`load-tests/station-business-race.js` tests actual Go station checkout and MES report writes under contention. The isolated k6 runner also tests the corresponding legacy Node APIs and the separate educational lab. All tests use temporary local databases; results are not production capacity claims.

ERP stock issues proportionally remove inventory cost and preserve rounding remainders; purchase returns are recorded against the supplied reference and do not create external logistics or supplier credits.

ERP invoice payments are demo ledger entries and do not initiate bank transfers. Journal posting requires balanced nonzero debits and credits and rejects closed fiscal periods.

MES start verifies actual BOM material movements in addition to the staged flag. New demo fixtures contain fully staged materials; existing spaces are preserved and may need material lots and issues before starting.

Commerce returns require a paid, shipped order, restore the returned quantity and record a demo refund; they do not reverse an external payment. Reviews are restricted to the original purchaser and front-office order lines are owner-filtered.

POS held carts do not reserve stock; checkout revalidates current prices and stock. Claimed carts remain visible to their claimant until completed or released.

Commerce multi-item checkout reserves each line in one transaction. If any reservation expires, all active reservations for the pending order are released together; payment checks the complete set against order lines.
