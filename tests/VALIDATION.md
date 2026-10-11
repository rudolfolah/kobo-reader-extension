# Validation

## Completed

Run: node tests/test.cjs (Node 18 or newer; no third-party packages).

All 14 logic tests passed using an instrumented DOM/MutationObserver double:
existing and newly inserted error; late message updates; unrelated messages
and dialogs; hidden dialogs; hidden-tab deferral; persisted cooldown and expiry;
blocked storage; healthy deep reader mutations; coalesced modal updates;
unrelated origins, persistent-error fallback to the library, a full
reload/redirect/stop chain, and healthy-page suppression of the redirect.
Manifest scope, top-frame restriction, and absence of
background worker and extra permissions were also checked.

100,000 simulated mutations deep in the healthy reader produced no additional
extension callbacks, queries, or layout checks. This verifies the configured
observer scope in the double; it is not a browser CPU/memory benchmark.

## Still needed in your browser

1. Install the extension and reload the reader once.
2. On the next naturally occurring session error, confirm one automatic reload.
   If it persists, confirm the tab returns to My Books once. Reopen the book
   with Read Now. A further error within five minutes must not bounce back.
3. With DevTools Performance, record comparable idle, scrolling, and page-turn
   sessions enabled and disabled. Inspect content.js execution and long tasks.
   There should be no recurring extension work while idle, and no callback
   caused by mutations strictly inside the reader subtree.
4. Confirm a fresh, unrelated tab has no Kobo Reader Extension content script.

A Chromium executable was unavailable in the development environment.
The actual signed-in Kobo page and real-browser performance have not been
tested. The supplied dialog and body hierarchy informed the implementation.
Do not treat the logic tests as proof of live performance or guaranteed recovery.

## Appearance validation (1.2.1)

Run node tests/theme-test.cjs. All 13 additional tests pass using an instrumented
DOM double: exact host scope, CSS-only website, top-frame-only scripts, native
theme selection, popup ownership, matching-theme fast path, dark/light changes,
hidden-tab deferral, error-dialog suppression, bounded timeout, no polling or
image filters, and manifest assets.

The supplied reader HTML includes the native Light/Sepia/Charcoal/Dark controls
and exact data-test-id selectors used by the implementation. The public Kobo
Canada homepage was inspected read-only for current colour tokens, including
--k-color-black, --k-color-white, --k-color-bg-light and --k-list-menu-bg.
No signed-in reader was available for an end-to-end appearance test. Website
CSS has not been visually tested across all pages; signed-in library/checkout
and legacy layouts may require further style adjustments.

After updating, toggle macOS System Settings > Appearance between Light and
Dark with the reader open. Confirm native body theme changes, chapter text
and UI colours, unchanged artwork, and settings popup closure. Then test the
website and your library. Inspect idle CPU and page-turn traces after theme
application; the temporary theme observer must be disconnected.

1.2.1 adds a regression case for a mounted header with an uninitialized book
engine: no settings or theme clicks occur until the loaded chapter and footer
are ready. Library styling now overrides legacy hardcoded text colours,
transparent wrappers, buttons, and menus. These fixes still need live
verification on the affected signed-in library and reader. The screenshot
showed a theme-change message-bus error; it does not prove the only cause of
the reader crash was the startup timing race.
