---
name: Vue Router
description: Vue Router 4/5 defects — components reused across param changes, captured params, misused next() and redirect loops in guards, beforeEnter scope, client-only authorization and ignored navigation failures.
priority: 60
activation:
  content:
    - "from ['\"]vue-router(?:/[a-z]+)?['\"]"
    - "\\b(?:useRoute|useRouter|onBeforeRouteUpdate|onBeforeRouteLeave|createRouter)\\s*\\("
    - "\\.(?:beforeEach|beforeResolve|afterEach)\\s*\\("
    - "\\bbeforeEnter\\s*:"
    - "\\$route(?:r)?\\b"
  examples:
    - 'import { useRoute } from ''vue-router'';'
    - 'const route = useRoute();'
    - 'router.beforeEach((to, from) => { if (!to.meta.public) return ''/login''; });'
    - '{ path: ''/admin'', beforeEnter: requireAuth },'
    - 'console.log(this.$route.params.id);'
sources:
  - https://router.vuejs.org/guide/advanced/navigation-guards.html
  - https://router.vuejs.org/guide/essentials/dynamic-matching.html
  - https://router.vuejs.org/guide/advanced/navigation-failures.html
  - https://router.vuejs.org/guide/advanced/composition-api.html
---
- **Reused instance**: data loaded once in setup/`onMounted` from `route.params.id` → going `/users/1` → `/users/2` reuses the component and shows stale data. Fix: `watch(() => route.params.id, load, { immediate: true })` or `onBeforeRouteUpdate`.
- **Captured params**: `const id = route.params.id` (or destructuring `route`) during setup → never updates. Fix: read `route.params.id` inside computed/watchers.
- **next() misuse**: guards using the third `next` argument that can call it twice or never (`if (!auth) next('/login')` followed by `next()`) → errors or stuck navigation. Fix: drop `next`; return `false` or a route location.
- **Redirect loop**: a global guard redirecting to `/login` without excluding the login route itself → infinite redirect. Fix: skip when `to.name` is the target.
- **beforeEnter scope**: auth or data logic in per-route `beforeEnter` → not run when only params, query or hash change. Fix: global `beforeEach` or `onBeforeRouteUpdate`.
- **Client-only authorization**: `meta.requiresAuth` guards treated as protection → the APIs remain callable directly. Fix: authorize on the server; guards are UX.
- **Ignored navigation result**: code after `router.push()` assumes success, but blocked or duplicated navigations resolve to a failure instead of throwing. Fix: `if (isNavigationFailure(await router.push(to))) …`.
