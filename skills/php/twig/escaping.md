---
name: Twig escaping and template injection
description: Twig XSS and SSTI traps — |raw and autoescape false, HTML escaping used in JS/CSS/URL/unquoted-attribute contexts, json_encode|raw in script tags, file-extension escaping (.txt.twig is not escaped), user-supplied template sources and names.
priority: 70
tags: [CWE-79, CWE-1336, CWE-94]
activation:
  files: ["**/*.twig"]
  content:
    - '\|\s*raw\b|\{%-?\s*autoescape\s+false|\|\s*e(?:scape)?\s*\(\s*[''"](?:js|css|url|html_attr)'
    - '->createTemplate\s*\(|\btemplate_from_string\s*\(|\bSandboxExtension\b|\bSecurityPolicy\b'
sources:
  - https://twig.symfony.com/doc/3.x/filters/escape.html
  - https://twig.symfony.com/doc/3.x/functions/template_from_string.html
  - https://twig.symfony.com/doc/3.x/sandbox.html
  - https://symfony.com/doc/current/reference/configuration/twig.html#autoescape-service
---
- **raw output**: `{{ comment.body|raw }}` or `{% autoescape false %}` around user-controlled data → stored XSS. Fix: sanitize rich text (e.g. `|sanitize_html` from Symfony HtmlSanitizer) instead of `raw`.
- **Context**: auto-escaping uses the HTML strategy → values inside `<script>`, `style`, event handlers, unquoted attributes or URLs need `|e('js')`, `|e('css')`, `|e('html_attr')` or `|e('url')` (URL parts only); `href="{{ url }}"` still runs `javascript:`.
- **JSON in script**: `<script>var d = {{ data|json_encode|raw }};</script>` breaks out on `</script>` inside a string. Fix: pass `JSON_HEX_TAG` flags or use a `data-` attribute with normal escaping.
- **Escaping by file name**: Symfony picks the strategy from the template name → `*.txt.twig` is not escaped at all and `*.js.twig` uses JS escaping; including a `.txt.twig` partial in an HTML page outputs raw data.
- **Template injection**: `$twig->createTemplate($userInput)`, `template_from_string()` or user-editable templates stored in the database execute attacker-chosen filters and functions → RCE or data disclosure. Fix: no user-authored templates, or the sandbox with a strict `SecurityPolicy`.
- **Dynamic template names**: `{% include page_name %}` or `render($request->get('tpl'))` with user input exposes any template the loader can reach (admin partials, `@Namespace/…` bundles). Fix: map input to an allowlist.
