---
name: Template XSS and injection
description: XSS sinks Vue does not neutralize — v-html, javascript URLs, style and on* bindings, attribute spreading, user-controlled templates and mounting over server-rendered user content.
category: security
priority: 72
tags: [CWE-79, CWE-1336, OWASP-A05]
activation:
  content:
    - "\\bv-html\\b"
    - "(?:^|\\s)(?::|v-bind:)(?:href|src|srcdoc|action|formaction|style|xlink:href)\\s*="
    - "(?:^|\\s):on[a-z]+\\s*="
    - "\\bv-bind\\s*=\\s*\""
    - "\\btemplate\\s*:\\s*[`'\"]"
    - "\\bcompile\\s*\\("
  examples:
    - '<div v-html="comment.body"></div>'
    - '<a :href="user.website">Visit</a>'
    - '<div :onclick="handler"></div>'
    - '<a v-bind="attrs">Link</a>'
    - 'template: ''<div>{{ userInput }}</div>'','
    - 'const render = compile(userTemplate);'
sources:
  - https://vuejs.org/guide/best-practices/security.html
  - https://vuejs.org/api/built-in-directives.html#v-pre
---
- **v-html**: `v-html` with API, CMS, Markdown or user data → stored/reflected XSS. Fix: sanitize with DOMPurify, or render as text.
- **javascript: URLs**: `:href`/`:src`/`:action` bound to user-supplied URLs — Vue does not check URL schemes → script runs on click. Fix: allowlist `http(s):`/`mailto:` (e.g. `@braintree/sanitize-url`) before binding.
- **Style injection**: `:style="userString"` or user-controlled CSS → invisible overlays, clickjacking. Fix: object syntax with allowlisted properties only.
- **Event attributes and spreading**: user strings bound to `:onclick`/`:onerror`, or `v-bind="userObject"` spreading attacker keys (`onclick`, `href`, `srcdoc`) → script execution. Fix: `@event` with component methods; pick allowed keys before spreading.
- **User templates**: `template:` strings, `compile()` or runtime-compiler builds fed user text → arbitrary JS (server-side code execution under SSR). Fix: never compile user input; render data, not templates.
- **Mount over server HTML**: mounting Vue on a container that includes server-rendered user content → `{{ … }}` inside it executes as a template expression. Fix: mount on a dedicated element or wrap user content in `v-pre`.
