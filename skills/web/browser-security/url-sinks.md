---
name: Script URLs and client-side redirects
description: DOM navigation sinks — user-controlled URLs in location, window.open or element URL properties running javascript/data URLs, client-side open redirects with bypassable checks, URL-resolution surprises and hash/query data reaching the DOM.
priority: 74
tags: [CWE-79, CWE-601]
activation:
  languages: [html, javascript, typescript, vue, svelte, php, text]
  content:
    - '\blocation(?:\.href)?\s*=[^=]|\blocation\.(?:assign|replace)\(|\bwindow\.open\('
    - '\.(?:href|src|action|formAction)\s*=[^=]|\bsetAttribute\(\s*[''"](?:href|src|action|formaction|xlink:href)'
    - '\bsearchParams\.get\(\s*[''"](?:next|redirect\w*|return\w*|callback\w*|continue|url|to)[''"]|\bnew URL\('
    - '\blocation\.(?:hash|search)\b'
  examples:
    - 'window.location = redirectUrl;'
    - 'link.href = userProvidedUrl;'
    - 'const next = searchParams.get("redirectTo");'
    - 'const token = location.hash.slice(1);'
sources:
  - https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html
  - https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html
  - https://developer.mozilla.org/en-US/docs/Web/API/URL/URL
  - https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/noopener
---
- **Script-capable URLs**: user or API URLs assigned to `location`, `window.open`, `a.href`, `iframe.src`, `form.action` or via `setAttribute` without a scheme check → `javascript:`/`data:` URLs run script. Fix: parse with `new URL()`, allow only `http:`/`https:` (+ `mailto:`/`tel:`).
- **Client-side open redirect**: `?next=`/`returnUrl`/`redirect` values passed to `location` after login → phishing, OAuth token leaks. `startsWith('/')` accepts `//evil.com` and `/\evil.com`; `includes('site.com')` accepts `site.com.evil.io`. Fix: resolve against `location.origin`, compare `url.origin`.
- **Base doesn't constrain**: `new URL(input, base)` returns `input`'s own origin when input is absolute or protocol-relative → "relative" paths reach other hosts. Fix: check the resulting `origin`.
- **Hash/query to DOM**: `location.hash`/`search` values fed to selectors (`$(location.hash)`), `innerHTML`, routers or `eval`-like APIs → DOM XSS. Fix: validate against expected formats.
- **Opener leaks**: `window.open(untrustedUrl)` without `noopener` → the opened page controls `window.opener` (reverse tabnabbing); `target="_blank"` links already imply `noopener`. Fix: `window.open(url, '_blank', 'noopener,noreferrer')`.
