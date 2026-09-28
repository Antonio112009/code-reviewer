---
name: Interaction responsiveness (INP)
description: Main-thread work that delays the next paint after input — heavy synchronous handlers, layout thrashing, unthrottled scroll/pointer listeners and non-passive touch/wheel listeners, unbounded DOM updates and unguarded scheduler.yield.
priority: 50
activation:
  content:
    - '\baddEventListener\(\s*[''"](?:scroll|resize|input|keydown|keyup|wheel|touchstart|touchmove|mousemove|pointermove)[''"]'
    - '\b(?:offset(?:Width|Height|Top|Left)|getBoundingClientRect|getComputedStyle|scrollHeight|clientHeight|scrollTop)\b'
    - '\bscheduler\.(?:yield|postTask)\b|\brequestAnimationFrame\(|\bcontent-visibility\b'
  examples:
    - 'window.addEventListener("scroll", handleScroll);'
    - 'const height = el.offsetHeight;'
    - 'requestAnimationFrame(() => updatePosition());'
sources:
  - https://web.dev/articles/optimize-inp
  - https://web.dev/articles/optimize-long-tasks
  - https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing
  - https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield
---
- **Heavy synchronous handlers**: click/input/keydown handlers that sort or filter large arrays, parse big JSON, write sync storage or re-render thousands of nodes → INP above 200 ms. Fix: paint the UI change first, then yield, debounce or use a worker.
- **Layout thrashing**: loops alternating DOM writes (`style`, `classList`, inserts) with reads (`offsetHeight`, `getBoundingClientRect`, `getComputedStyle`, `scrollTop`) → a forced synchronous layout per iteration. Fix: batch reads, then writes; `requestAnimationFrame`.
- **Unthrottled continuous events**: expensive work per `scroll`/`resize`/`pointermove` event, or `touchstart`/`touchmove`/`wheel` listeners without `{ passive: true }` → janky, delayed scrolling. Fix: passive listeners, rAF throttling, `IntersectionObserver`/`ResizeObserver`.
- **Unbounded DOM**: rendering full lists, tables or large SVGs on interaction → long presentation delay. Fix: virtualization, pagination, `content-visibility: auto`.
- **Unguarded `scheduler.yield()`**: called without feature detection → TypeError where unsupported (not Baseline). Fix: `globalThis.scheduler?.yield ? scheduler.yield() : new Promise(r => setTimeout(r, 0))`.
