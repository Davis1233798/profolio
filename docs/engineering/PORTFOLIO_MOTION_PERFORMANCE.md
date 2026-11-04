# Responsive portfolio motion

## Architecture and boundaries

Keep the requested Three.js click/language effects and bilingual portfolio while removing measured-in-code sources of unnecessary work. Ordinary navigation must use its native/Next link behavior immediately; no fixed departure delay. Animate only opacity/transform on arrival/language change, never blur the entire page. Keep the aurora visual as a static gradient and retain a small transform-only orbital motion; avoid repeated giant blur/backdrop filtering.

One lazy particle controller per mounted canvas owns one renderer, geometry, material and bounded position buffers. Pulses reuse those resources, restart a short animation, and stop requesting frames when settled. Full disposal happens on unmount/context loss. Reduced motion creates no renderer; hidden documents stop frames. Keep low pixel ratio and a bounded particle count, retaining visible 3D effects rather than claiming a static image replaces them.

Spotlight cards only schedule work when visible and the pointer is inside or within their proximity. Offscreen cards must not read layout or repaint on every global pointer event. Existing keyboard focus behavior and stop-when-settled semantics remain intact. Do not change authentication, business routes, data tools or other station themes.

## Tests before implementation

Extend remote Chromium coverage to instrument WebGL2 drawing/context creation: repeated language switches reuse one context, rendering settles and stays idle afterwards, reduced motion skips initialization, and arrival/language transitions contain no filter animation. Scroll cards out of view, move the pointer and verify their style does not change. Verify native page navigation is not prevented by the motion wrapper. Preserve existing bilingual, keyboard, fallback and mobile tests. Capture timing/frames/context counters as CI artifacts; these verify bounded work, not a promise of a particular FPS on every visitor device. No local application tests/builds.

## Acceptance

Review the PR and exact-head remote checks, merge stable code to main, let GitHub deploy to OCI, then verify the served revision and browser behavior when browser access is available. Browser automation is currently disabled in the user's Work settings; do not bypass it using another local automation path. Source inspection alone does not prove the reported device's frame rate.
