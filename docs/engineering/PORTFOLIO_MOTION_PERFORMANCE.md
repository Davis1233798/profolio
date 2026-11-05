# Responsive portfolio motion

## Architecture and boundaries

Keep the requested Three.js click/language effects and bilingual portfolio while removing measured-in-code sources of unnecessary work. Ordinary navigation must use its native/Next link behavior immediately; no fixed departure delay. Animate only opacity/transform on arrival/language change, never blur the entire page. Keep the aurora visual as a static gradient and retain a small transform-only orbital motion; avoid repeated giant blur/backdrop filtering.

One lazy particle controller per mounted canvas owns one renderer, geometry, material and bounded position buffers. Pulses reuse those resources, restart a short animation, and stop requesting frames when settled. The controller is released after ten seconds without a pulse and immediately when the document is hidden; final disposal frees GPU objects and forces context loss. The canvas is replaced before a later pulse can create a fresh WebGL context. Reduced motion creates no renderer. Cap the drawing buffer to 2.5 million pixels as well as capping DPR at 1.25 and particle count at 520. These limits bound the effect's allocation on large/high-DPI displays.

Spotlight cards only schedule work when visible and the pointer is inside or within their proximity. Offscreen cards must not read layout or repaint on every global pointer event. Existing keyboard focus behavior and stop-when-settled semantics remain intact. Do not change authentication, business routes, data tools or other station themes.

## Regression coverage

Remote Chromium coverage instruments WebGL context creation/loss and drawing: repeated language switches reuse one context while active, rendering settles and stays idle afterwards, an idle controller releases its context and a later pulse initializes a new one, reduced motion skips initialization, and arrival/language transitions contain no filter animation. Scroll cards out of view, move the pointer and verify their style does not change. Verify native page navigation is not prevented by the motion wrapper. Preserve existing bilingual, keyboard, fallback and mobile tests. Capture timing/frames/context counters as CI artifacts; these verify bounded work, not a promise of a particular FPS or total browser heap on every visitor device.

The station operations snapshot refreshes only after the prior request completes, pauses while the document is hidden, aborts hidden/unmounted requests, and times out stalled requests. Its refresh timer is therefore at most one and does not retain response histories. TrafficLab keeps at most 512 outcomes and renders at most 80 timeline rows. The station dataset API caps each loaded dataset at 500 rows; those rows and their DOM are an intentional current-page working set, not an unbounded cache. Closing print preview releases its separately fetched dataset map. Source inspection found no evidence of an unbounded traffic history or catalog cache. These checks establish lifecycle bounds; they do not constitute a long-running browser heap measurement.

## Acceptance

Review the PR and exact-head remote checks, merge stable code to main, let GitHub deploy to OCI, then verify the served revision and browser behavior when browser access is available. Browser automation is currently disabled in the user's Work settings; do not bypass it using another local automation path. Source inspection alone does not prove the reported device's frame rate.
