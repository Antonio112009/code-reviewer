---
name: Signals, computed and effects
description: Angular signal defects — in-place mutations that never notify, effects used to propagate state, reads lost after await, injection-context errors, early reads of required inputs and linkedSignal resets.
priority: 64
activation:
  content:
    - "(?<![.\\w$])(?:signal|computed|effect|linkedSignal|untracked|afterRenderEffect)\\s*(?:<[^>\\n]{0,80}>)?\\("
    - "(?<![.\\w$])(?:input|model)(?:\\.required)?\\s*(?:<[^>\\n]{0,80}>)?\\("
    - "\\b(?:viewChild|viewChildren|contentChild|contentChildren)(?:\\.required)?\\s*[(<]"
  examples:
    - 'readonly count = signal(0);'
    - 'readonly userId = input.required<string>();'
    - 'readonly list = viewChild.required<ElementRef>(''list'');'
  versions: { framework.angular: ">=16" }
sources:
  - https://angular.dev/guide/signals
  - https://angular.dev/guide/signals/effect
  - https://angular.dev/guide/signals/linked-signal
  - https://angular.dev/errors/NG0950
---
- **In-place mutation**: `items().push(x)`, `user().name = …`, or `update(a => { a.push(x); return a; })` → same reference, `Object.is` equality sees no change; computed values and views stay stale. Fix: return new arrays/objects.
- **Effect as state propagation**: `effect(() => this.total.set(…))` copying one signal into another → extra change-detection passes, loops, NG0100. Fix: `computed()` or `linkedSignal()`.
- **Reads after await**: signals read after `await` or inside `setTimeout` in an `effect`/`computed` are not tracked → no rerun. Fix: read them synchronously first.
- **Injection context**: `effect()` or `toSignal()` created in `ngOnInit`, event handlers or after `await` → NG0203. Fix: create them in the constructor/field initializers, or pass `{ injector }`.
- **Early required reads**: reading `input.required()`/`viewChild.required()` in the constructor or a field initializer → NG0950. Fix: read in `computed`, the template or `ngOnInit` and later.
- **linkedSignal resets**: user edits held in a `linkedSignal` are discarded whenever its source changes (e.g. list reload) → lost selection or input. Fix: use `previous` to keep still-valid values.
- **Mutating input objects**: mutating objects received via `input()` → changes the parent's data behind its signals (no notification). Fix: emit via `output()`/`model()` and let the owner update immutably.
