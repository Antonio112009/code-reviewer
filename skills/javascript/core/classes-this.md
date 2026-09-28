---
name: Classes and this
description: Methods that lose this when passed as callbacks, subclass field initialization order, instance arrow fields shadowing overrides, private fields behind proxies, shared static state and cross-realm instanceof.
priority: 55
activation:
  content:
    - '\bclass\s+[A-Za-z_$]'
    - '[(,]\s*this\.[A-Za-z_$][\w$]*\s*[,)]'
    - '\.bind\s*\('
    - '\bsuper\s*[.(]'
    - '\bstatic\s+[A-Za-z_$#]'
    - '\binstanceof\b'
  examples:
    - 'class Timer extends Base {'
    - 'setTimeout(this.tick, 1000);'
    - 'const bound = this.handleClick.bind(this);'
    - 'super.render();'
    - 'static #cache = new Map();'
    - 'if (value instanceof Error) { throw value; }'
sources:
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/this#callbacks
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Public_class_fields
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Private_elements
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/isError
---
- **Extracted methods lose `this`**: `setTimeout(this.tick, 1000)`, `arr.map(this.format)`, `promise.then(this.onDone)`, `emitter.on('x', obj.handle)` → `this` is `undefined` (TypeError). Fix: arrow wrapper or `bind` once, keeping the bound reference for `removeListener`.
- **Subclass fields initialize after `super()`**: a base constructor calling an overridden method sees `undefined` subclass fields, and field initializers overwrite values the base constructor or a setter assigned. Fix: no virtual calls in constructors.
- **Instance arrow fields beat methods**: a base-class field `handle = () => {}` is an own property, so a subclass method `handle()` never runs and `super.handle()` fails. Fix: prototype methods when overriding is intended.
- **`#private` behind proxies or copies**: methods reading `#x` throw `TypeError` when `this` is a Proxy (Vue `reactive`, MobX observables) or a spread/`structuredClone` copy. Fix: call on the raw object, or avoid `#` in proxied classes.
- **Shared static state**: `static cache = new Map()` on a base class is the same object for every subclass → cross-subclass pollution. Fix: per-class storage keyed by `this`, or instance fields.
- **`instanceof` across realms or copies**: values from iframes, `vm` contexts, workers or a duplicated package version fail `instanceof` → wrong error or type branch. Fix: `Array.isArray`, `Error.isError` (Node ≥24.3, Chrome 134), `name`/brand checks.
