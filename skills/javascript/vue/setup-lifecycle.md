---
name: Setup context, lifecycle and composables
description: Lifecycle hooks, composables and provide/inject used outside the synchronous setup context, missing teardown, snapshot inputs, stale injections, KeepAlive side effects and async setup without Suspense.
priority: 62
activation:
  content:
    - "\\bon(?:Before)?(?:Mount|Unmount|Update)(?:ed)?\\s*\\("
    - "\\bon(?:Activated|Deactivated|ServerPrefetch|ErrorCaptured|ScopeDispose)\\s*\\("
    - "(?<![.\\w$])(?:provide|inject|getCurrentInstance|effectScope|toValue)\\s*(?:<[^>\\n]{0,80}>)?\\("
    - "\\basync\\s+setup\\s*\\("
    - "<(?:KeepAlive|keep-alive)\\b"
  examples:
    - 'onMounted(() => { window.addEventListener(''resize'', onResize); });'
    - 'onActivated(() => resumePolling());'
    - 'const user = inject(userKey);'
    - 'export default { async setup() { const data = await load(); return { data }; } };'
    - '<KeepAlive><component :is="view" /></KeepAlive>'
  files: ["**/composables/**/*.{ts,js}", "**/use[A-Z]*.{ts,js}"]
  versions: { framework.vue: ">=3" }
sources:
  - https://vuejs.org/guide/essentials/lifecycle.html
  - https://vuejs.org/guide/reusability/composables.html
  - https://vuejs.org/guide/components/provide-inject.html
  - https://vuejs.org/guide/built-ins/keep-alive.html
---
- **Hook after await**: `onMounted`/`onUnmounted`, `watch`, `provide`/`inject` or a composable called after `await` in `async setup()` or inside a composable (only `<script setup>` top level restores the instance) → never registered or never cleaned up. Fix: register before the first `await`.
- **Deferred composable call**: `useX()` inside event handlers, `setTimeout` or `.then()` → no active instance; hooks and injections are lost. Fix: call composables synchronously during setup.
- **No teardown**: `addEventListener`, `setInterval`, sockets or third-party widgets created in setup/`onMounted` without `onUnmounted`/`onScopeDispose` → leaks and duplicated handlers after remounts. Fix: pair each subscription with a teardown.
- **Snapshot input**: a composable reading `url.value` or a plain argument once → ignores later changes. Fix: accept `MaybeRefOrGetter` and call `toValue()` inside `watchEffect`/`computed`.
- **Non-reactive provide**: `provide('user', user.value)` or a plain snapshot → injectors never update; injectors mutating provided state → untraceable writes. Fix: provide `readonly(ref)` plus mutation functions.
- **KeepAlive side effects**: cached components are deactivated, not unmounted → timers, polling and listeners keep running; `include` matches only the component `name`; no `max` → unbounded cache. Fix: pause in `onDeactivated`, set `max`.
- **Async setup without Suspense**: `async setup()` or top-level `await` in `<script setup>` renders nothing unless an ancestor `<Suspense>` exists. Fix: add `<Suspense>` or load data in `onMounted`/a watcher.
