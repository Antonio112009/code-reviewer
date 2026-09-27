---
name: Template XSS in Svelte
description: Svelte XSS sinks — {@html} with untrusted content, javascript URLs in attributes, spreading untrusted attribute objects, user-controlled svelte:element tags and saved contenteditable HTML.
category: security
priority: 72
tags: [CWE-79, OWASP-A05]
activation:
  content:
    - "\\{@html\\b"
    - "\\b(?:href|src|action|formaction|srcdoc)=\\{"
    - "\\{\\.\\.\\.[a-zA-Z_$][\\w$.]{0,80}\\}"
    - "<svelte:element\\b"
    - "\\bbind:(?:innerHTML|innerText|textContent)\\b"
sources:
  - https://svelte.dev/docs/svelte/@html
  - https://github.com/sveltejs/svelte/issues/6423
  - https://github.com/sveltejs/svelte/security/advisories/GHSA-f7gr-6p89-r883
  - https://github.com/sveltejs/svelte/security/advisories/GHSA-m56q-vw4c-c2cp
---
- **{@html} with untrusted data**: `{@html}` rendering API, CMS, Markdown or user text → XSS; Svelte does not sanitize. Fix: sanitize (DOMPurify) or render as text.
- **javascript: URLs**: `href={user.website}`/`src={…}` from user data — attribute values are escaped but URL schemes are not checked → script runs on click. Fix: allowlist `http(s):`/`mailto:` before binding.
- **Spreading untrusted objects**: `<a {...attrs}>` with user- or API-controlled objects → attacker sets `onclick`, `href`, `srcdoc`, `style`; Svelte ≤5.51.4 also rendered event-handler attributes from spreads during SSR. Fix: pick allowed keys; upgrade.
- **Dynamic tag names**: `<svelte:element this={userTag}>` with unvalidated input → HTML injection in SSR (≤5.51.4) and arbitrary elements (`script`, `iframe`) on the client. Fix: map through an allowlist of tags.
- **Stored contenteditable HTML**: `bind:innerHTML` on user-editable content that is saved and shown to others → stored XSS. Fix: sanitize on save and on render.
