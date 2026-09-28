---
name: DOM XSS sinks
description: DOM-level XSS in any framework or vanilla code — untrusted strings in innerHTML-style sinks and jQuery, sanitize-then-mutate bugs, unsanitized Markdown output, permissive DOMPurify configs and unsafe use of the Sanitizer API and Trusted Types.
priority: 76
tags: [CWE-79, OWASP-A05]
activation:
  languages: [html, javascript, typescript, vue, svelte, php, text]
  content:
    - '\b(?:innerHTML|outerHTML|insertAdjacentHTML|srcdoc|createContextualFragment|setHTMLUnsafe|parseHTMLUnsafe)\b'
    - '\bdocument\.write(?:ln)?\(|\.html\(|\$\(\s*[`''"]\s*<|\bparseFromString\('
    - '(?:\bfrom|\bimport|\brequire\()\s*[''"](?:dompurify|isomorphic-dompurify|sanitize-html|xss|marked|markdown-it|showdown|micromark)[''"]'
    - '\bDOMPurify\b|\bsetHTML\(|\btrustedTypes\b'
  examples:
    - 'el.innerHTML = userBio;'
    - "$('<div>' + userInput);"
    - 'import DOMPurify from "dompurify";'
    - 'const clean = DOMPurify.sanitize(html);'
sources:
  - https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html
  - https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API
  - https://developer.mozilla.org/en-US/docs/Web/API/Element/setHTML
  - https://github.com/cure53/DOMPurify
---
- **Untrusted HTML in DOM sinks**: API, URL, storage or user strings assigned to `innerHTML`/`outerHTML`, `insertAdjacentHTML`, `document.write`, `srcdoc`, `createContextualFragment`, `setHTMLUnsafe`, jQuery `.html()`/`$('<…' + data)` → script execution. Fix: `textContent`/DOM APIs; sanitize real rich text.
- **Sanitize, then mutate**: DOMPurify output later concatenated, `replace()`d, entity-decoded or re-parsed (inserted into a template string, Markdown rendered after sanitizing) → mutation-XSS bypasses. Fix: sanitize the final string immediately before the sink.
- **Markdown/rich text**: `marked`, `markdown-it`, `showdown` output inserted as HTML with raw HTML enabled and no sanitizer → stored XSS via `<img onerror>`, `javascript:` links. Fix: sanitize the rendered HTML or disable raw HTML.
- **Permissive sanitizer config**: DOMPurify `ADD_TAGS`/`ADD_ATTR`/`ALLOWED_URI_REGEXP` allowing `script`, `iframe`, `form`, `style`, `on*` attributes or `javascript:` URIs, or `sanitize-html` allowing all attributes → XSS or phishing. Fix: minimal allowlists.
- **Sanitizer API and Trusted Types**: `Element.setHTML()` without feature detection (not Baseline, no Safari) → throws; a Trusted Types `default` policy or `createHTML: s => s` passing strings through → protection disabled. Fix: DOMPurify fallback; sanitize inside policies.
