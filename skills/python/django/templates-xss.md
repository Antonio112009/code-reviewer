---
name: Template escaping and XSS
description: Django template and HTML-building XSS traps — mark_safe/SafeString on input, pre-formatted format_html(), |safe and autoescape off, JSON inside script tags, unquoted attributes, javascript URLs and templates built from input.
priority: 72
tags: [CWE-79, A05:2025]
activation:
  files: ["**/templatetags/*.py"]
  content:
    - '\b(?:mark_safe|SafeString|SafeText|format_html|format_html_join|conditional_escape)\b'
    - '\|\s*(?:safe|safeseq|escapejs|json_script)\b'
    - '\{%-?\s*autoescape\s+off\b'
    - '\bis_safe\s*=\s*True\b'
    - '<script\b[^>\n]{0,80}>[^<\n]{0,200}\{\{'
    - '\b(?:href|src|action)=["'']?\{\{'
    - '\b(?:Template|from_string)\(\s*(?:request|self\.request|data|text|body|content|user)'
  examples:
    - 'return mark_safe(f"<div>{user_bio}</div>")'
    - '{{ comment.body|safe }}'
    - '{% autoescape off %}'
    - '@register.filter(is_safe=True)'
    - '<script>var data = {{ user_json }};</script>'
    - '<a href="{{ profile_url }}">Profile</a>'
    - 'return Template(request.POST["template"]).render(Context({}))'
sources:
  - https://docs.djangoproject.com/en/stable/ref/utils/#django.utils.html.format_html
  - https://docs.djangoproject.com/en/stable/ref/templates/builtins/#json-script
  - https://docs.djangoproject.com/en/stable/ref/templates/builtins/#escapejs
  - https://docs.djangoproject.com/en/stable/topics/security/#cross-site-scripting-xss-protection
---
- **mark_safe on input**: `mark_safe(f"...{value}")`, `SafeString(...)` or a filter registered `is_safe=True` that returns input-derived text → stored/reflected XSS. Fix: `format_html()` or `escape()` each value.
- **Pre-formatted format_html()**: `format_html(f"<b>{name}</b>")` or `format_html("<b>%s</b>" % name)` escapes nothing (and without args raises `TypeError` on 6.0+). Fix: `format_html("<b>{}</b>", name)`.
- **Escaping disabled**: `{{ value|safe }}`, `|safeseq` or `{% autoescape off %}` around model or request data. Fix: keep autoescape; sanitise rich text with an allowlist sanitizer before marking safe.
- **JSON in `<script>`**: `{{ data|safe }}` or `mark_safe(json.dumps(...))` inside a script block → `</script>` breakout. Fix: `{{ data|json_script:"id" }}`; `escapejs` is not safe in JS template literals or HTML contexts.
- **Attribute and URL contexts**: unquoted `href={{ url }}` allows attribute injection; quoted `href="{{ url }}"` still runs `javascript:` URLs. Fix: quote attributes, allow only `http`/`https` schemes.
- **Templates built from input**: `Template(user_text).render(Context({...}))` or `engines[...].from_string(user_text)` lets users read anything reachable from the context (`{{ request.user.password }}`, settings objects). Fix: fixed templates; pass plain data.
