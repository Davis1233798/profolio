# Isolated k6 transaction and contention tests

Grafana k6 is a dedicated load-testing tool. CI installs the pinned k6 version and runs `python scripts/run-k6-isolated.py` after both frontend builds. The runner starts two loopback-only services using temporary SQLite databases; it never sends traffic to the public site or touches its persistent volumes. Summaries are uploaded as a CI artifact and written locally under ignored `outputs/k6`.

- `business-race.js` calls the existing Node business APIs. Each scenario creates a new demo tenant. The commerce scenario races 64 unique checkout requests for the last item; the MES scenario races 64 unique full-target production reports. Both assert one success, 63 recognized capacity conflicts, and the final order/report and inventory/production invariants.
- `station-business-race.js` exercises the actual Go station checkout and production report APIs with isolated accounts and database records. It verifies a single commit under 64 concurrent competing requests and checks the resulting stock or output totals.
- `station-cart-race.js` sends concurrent multi-variant checkout requests to the Go station, checks both stock balances and order lines, and verifies simulated payment for the winning order.
- `traffic-lab.js` exercises the Go station's separate lab tables with 256 requests and 16 virtual users. It checks finite capacity, duplicate request handling, durable pending records and idempotent manual consumption. These are simulated orders/reports in lab tables, not the Node transactions or a real fulfillment broker.

Each scenario sends real HTTP requests; default values are intentionally bounded for CI. To explore different contention levels locally, set `VUS` and `ITERATIONS` before invoking the runner. `CAPACITY` applies only to the Go lab. Scripts reject non-loopback targets. This single-machine test is a correctness and contention test, not a production load capacity or availability claim; do not compare its throughput to public multi-node traffic.

Prerequisites: Node 24, Go, Python 3, and [Grafana k6](https://grafana.com/docs/k6/latest/) on PATH (or set `K6_BIN`). Run `npm run install:ci`, `npm run web:build`, `npm run build`, then `python scripts/run-k6-isolated.py`. Run it from this checkout; it creates and removes only its own temporary server databases.

The Go station UI is still a migration preview. Its identity and data store are separate from the Node application. MES and commerce station transactions are persisted in the separate Go database; other workflows remain to be migrated. These tests do not establish production capacity or external payment and delivery.
