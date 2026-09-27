---
name: React XSS sinks
description: XSS through React escape hatches — dangerouslySetInnerHTML with untrusted HTML, javascript-scheme URLs in URL props (executed up to React 18), spreading untrusted objects as props, unescaped JSON in SSR script tags and untrusted srcDoc.
priority: 72
tags: [CWE-79, OWASP-A05]
activation:
  content:
    - "\\bdangerouslySetInnerHTML\\b"
    - "\\b(?:href|src|action|formAction|srcDoc)=\\{"
    - "javascript:"
sources:
  - https://react.dev/reference/react-dom/components/common
  - https://github.com/facebook/react/blob/main/CHANGELOG.md
  - https://react.dev/blog/2026/09/09/react-19-3
---
- **Unsanitized HTML**: user, CMS, markdown-rendered or API HTML passed to `dangerouslySetInnerHTML` without sanitizing (e.g. DOMPurify) at render time → stored XSS. Fix: strict allowlist sanitizer, or render text/elements.
- **javascript: URLs**: `href`, `src`, `action` or `formAction` built from user data → React ≤18 executes `javascript:` URLs (only warns since 16.9); React 19 swaps them for a throwing stub. Fix: parse with `new URL` and allow only `https:`/`mailto:`.
- **Spreading untrusted props**: `<div {...attrsFromApi}>` or `<a {...linkData}>` lets data set `dangerouslySetInnerHTML`, `href`, `srcDoc`, `style` or `formAction` → XSS. Fix: pick allowed props explicitly.
- **JSON in SSR script tags**: `` __html: `window.__STATE__=${JSON.stringify(data)}` `` → a `</script>` or `<!--` inside the data breaks out → XSS. Fix: escape `<` as `\u003c` or use a safe serializer.
- **Untrusted srcDoc**: `<iframe srcDoc={html}>` runs scripts with your origin unless sandboxed, and `sandbox="allow-scripts allow-same-origin"` removes the protection. Fix: `sandbox` without `allow-same-origin`.
- **Trusted Types**: under a `require-trusted-types-for 'script'` CSP, React < 19.3 stringifies TrustedHTML values, which the browser then blocks; 19.3+ passes them through.
