---
name: Template directives and client scripts
description: Astro template and script defects — set:html XSS, define:vars forcing inline scripts, bundled scripts that run once under the ClientRouter, re-executed inline scripts and duplicated global listeners.
priority: 62
tags: [CWE-79]
activation:
  content:
    - "\\bset:html\\b"
    - "\\bdefine:vars\\b"
    - "\\bis:inline\\b"
    - "<(?:ClientRouter|ViewTransitions)\\b"
    - "\\bastro:(?:page-load|after-swap|before-swap|before-preparation)\\b"
    - "\\bdata-astro-rerun\\b|\\btransition:persist\\b"
sources:
  - https://docs.astro.build/en/reference/directives-reference/
  - https://docs.astro.build/en/guides/view-transitions/
---
- **set:html with untrusted data**: `set:html` (on elements or `<Fragment>`) is not escaped → XSS with CMS, Markdown or user content. Fix: sanitize first, or use `set:text`/`{expression}`.
- **define:vars side effects**: `<script define:vars={…}>` implies `is:inline` → not bundled or deduplicated, no imports/TypeScript, emitted per component instance. Fix: pass data via `data-*` attributes read by a bundled script.
- **Scripts run once with ClientRouter**: bundled `<script>` code that queries the DOM or binds listeners at load → after a client-side navigation the new page's elements have no listeners. Fix: run setup in `document.addEventListener('astro:page-load', …)`.
- **Re-executed inline scripts**: `is:inline` scripts on pages visited again, or with `data-astro-rerun`, may execute on each visit → double initialization (analytics, widgets). Fix: guard with a flag, or use a bundled script plus `astro:page-load`.
- **Duplicated global listeners**: adding `document`/`window` listeners inside an `astro:page-load` handler → one more listener per navigation. Fix: bind global listeners once; remove per-page ones on `astro:before-swap`.
