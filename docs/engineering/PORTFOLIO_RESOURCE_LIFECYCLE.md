# Portfolio browser resource lifecycle acceptance

## Architecture and boundaries

The portfolio shell remains mounted while client navigation changes routes. Its
locale controls, animated project detail previews, filters, platform page, and
lazy Three.js canvas are exercised together because repeated transitions are
where retained component state, detached DOM, event listeners, timers, and GPU
contexts can accumulate. The existing Chromium browser job already builds the
site and runs the motion/locale Playwright suite; resource lifecycle coverage
belongs in that same job and browser config.

The long-run scenario warms both portfolio and platform routes first, then runs
six batches of six cycles each, with locale switches, project detail open/close
cycles, filters, and client route transitions in every cycle. It samples
Chromium's `JSHeapUsedSize` after `HeapProfiler.collectGarbage`, records DOM
node, listener, document, and frame counts, tracks in-flight browser `fetch`
calls, and watches iframe/canvas/WebGL context lifecycle. It also checks that
hidden-page and idle disposal release the active renderer, and that returning
to visible state can still render a fresh pulse. CI uploads the measurement
samples with the existing browser artifacts. Each batch sample is attached
before its resource assertions so failing runs preserve the measurements; the
cumulative heap series is attached before the retention thresholds are checked.

These are regression bounds for one Chromium runner and this repeatable
interaction workload. The post-GC heap ceiling is 40 MiB above the warmed
baseline to accommodate normal runtime/cache variation. A separate monotonic
retention check fails only when each of the final four batch deltas exceeds
1.5 MiB and their combined growth exceeds 8 MiB. Samples are diagnostic signals
rather than a precise per-component heap attribution.

`JSHeapUsedSize` is V8 JavaScript heap only. CDP DOM/listener counters describe
browser-managed document state. Neither measures GPU allocation, WebGL driver
memory, total Chromium process RSS, compositor memory, or behavior on other
browsers/devices. Context creation/loss and canvas dimensions provide separate
resource lifecycle bounds, not GPU byte counts. The fetch instrumentation sees
page `window.fetch`; it does not account for every browser/network-service
request, service worker, or prefetch mechanism. The status request case is a
browser interaction with a deliberately delayed stub response to deterministically
check the UI's pending/busy behavior; it is not an API latency or production
polling benchmark.

Existing motion/locale checks retain their headless browser configuration. The
resource project uses real headful Chromium under Xvfb/Openbox without video or
trace screencasting: active capture can affect Chromium's visibility lifecycle
and adds recording overhead to the repeated workload. DOM/source traces, raw
post-GC metrics and failure screenshots remain available. Real minimized-window
and `document.hidden` assertions remain mandatory; disabling capture is not a
substitute for observing them pass.

## Acceptance coverage

- Repeat language changes, project detail previews, filter changes, and
  home/platform client navigation in batches without unbounded iframe, canvas,
  concurrent WebGL context, DOM node, listener, frame, or document growth.
- After forced garbage collection, keep retained JavaScript heap below the
  documented absolute allowance over the warmed baseline and reject a
  practically monotonic increase across the final batches. Preserve all raw
  samples as a CI artifact for threshold review.
- While the particle renderer is active, minimize its real Chromium window
  under Xvfb/Openbox, verify its window state, and assert the tab reports `document.visibilityState ===
  'hidden'` and `document.hidden === true`; verify context loss and draw
  quiescence. Restore the window and bring the tab forward again; assert it reports
  `visible` before verifying a later pulse renders. Also verify the normal idle
  timeout releases the renderer.
- Delay a platform status response, confirm the submit control stays busy and
  prevents duplicate status requests, then navigate away and verify requests
  settle with no periodic status traffic after the page is idle.

These acceptance checks do not change production code. If the remote Chromium
job reports a repeatable regression, investigate that evidence in a separate
change before altering production lifecycle behavior.
