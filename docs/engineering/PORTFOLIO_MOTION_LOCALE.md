# Portfolio motion and language

## Architecture

Reference: https://www.bootstrapmb.com/tag/threejs, particularly glowing particle morphs and particle dispersion. Build an original Three.js particle portal rather than copying unlicensed template source. The persistent SuiteFrame owns one lazily loaded, transparent, pointer-transparent WebGL canvas. Clicking navigation or interactive controls emits a short particle pulse at the interaction origin; route changes emit an arrival pulse. Ordinary page navigation gets a fixed 220 ms departure beat independent of WebGL loading; business actions, downloads, modified/new-tab clicks and reduced-motion navigation remain immediate. Failed WebGL or animation cannot trap links. The effect also covers project links opening other system pages; business actions retain their existing semantics.

The portfolio owns an English/Traditional Chinese context. English is the initial SSR language. A persistent language control changes React-rendered copy, document language and the saved local preference without reloading or losing forms. The same particle portal uses a distinct violet/lime morph for language changes. Home, infrastructure overview, data tools and shared chrome use the context; legacy station components remain compatible and motion is shared by the root layout.

## Boundaries

No database, auth, backup or deployment permission changes. Never translate identifiers, user data, code samples, API errors or URLs by mutating DOM text. Use explicit bilingual React copy. Canvas is decorative and aria-hidden, never captures pointer events, and is omitted during print. Reduced motion skips WebGL and uses a brief non-spatial status update. Renderer resources, listeners and animation frames are disposed on completion/unmount/context loss. Limit particle count/pixel ratio and render only while an effect is active. WebGL failure falls back to CSS feedback; language switching and links continue to work.

## Tests before code

Unit-test locale validation/default/storage failures and click eligibility: no effect on modified clicks, downloads, disabled controls, inputs or print. A remote browser acceptance test verifies real language content changes, persistence after reload, lang metadata, keyboard language switching, route navigation, WebGL/CSS fallback and reduced-motion behavior. CI performs typecheck/build; no local application tests/builds.

## Acceptance and current work

Developing profolio shared click/navigation motion and bilingual home/infrastructure controls. Push a PR, review and run remote CI, then merge the stable head to main and verify OCI visually. This feature does not complete independent system deployment or all earlier project work.
