---
name: Form actions and CSRF
description: SvelteKit form-action defects — missing per-action authorization, secrets echoed through fail(), method-preserving redirects, use:enhance callbacks that skip updates, weakened CSRF origin checks and endpoints outside their scope.
category: security
priority: 68
tags: [CWE-352, CWE-862]
activation:
  content:
    - "\\bexport\\s+const\\s+actions\\b"
    - "\\bfail\\s*\\(\\s*[0-9]{3}"
    - "\\buse:enhance\\b"
    - "\\b(?:checkOrigin|trustedOrigins)\\b"
    - "\\brequest\\.formData\\s*\\(\\s*\\)"
sources:
  - https://svelte.dev/docs/kit/form-actions
  - https://svelte.dev/docs/kit/configuration
---
- **Unauthorized actions**: actions assuming the page's `load` already checked the user → actions are separate POST endpoints anyone can call. Fix: check session and ownership inside every action.
- **Echoed secrets**: `fail(400, { ...data })` or returning the whole submitted object → passwords or card numbers re-rendered in `form` and the page HTML. Fix: return only safe fields.
- **Method-preserving redirect**: `redirect(307/308, …)` after an action → the browser re-sends the POST to the new URL. Fix: `redirect(303, …)`.
- **use:enhance callbacks**: custom `use:enhance` callbacks that never call `update()` → no `invalidateAll`, stale data, form not reset. Fix: call `update()` or `applyAction()`; still validate on the server.
- **Weakened CSRF**: `csrf.checkOrigin: false` (deprecated) or `csrf.trustedOrigins: ['*']`/broad lists → cross-site form posts succeed with victims' cookies. Fix: keep the check; list exact origins.
- **CSRF scope**: the built-in origin check covers only form content types (`x-www-form-urlencoded`, `multipart/form-data`, `text/plain`) in production → `+server.ts` handlers accepting other bodies with cookie auth need their own checks. Fix: verify `Origin` or require JSON.
