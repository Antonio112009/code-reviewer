---
name: WordPress output escaping
description: WordPress XSS traps — output not escaped late with the right esc_* function, unescaped translation helpers, esc_js/esc_html used in the wrong context, the_title/get_the_title in attributes and unescaped add_query_arg() URLs.
priority: 72
tags: [CWE-79, CWE-116]
activation:
  content:
    - '\b(?:echo|print|printf)\b[^;\n]{0,120}\$|<\?=\s*\$'
    - '\b_[ex]\s*\(|\b__\s*\(|\besc_(?:html|attr|url|js|textarea)\w*\s*\(|\bwp_kses\w*\s*\('
    - '\b(?:the_title|get_the_title|get_the_excerpt|add_query_arg|wp_localize_script)\s*\('
sources:
  - https://developer.wordpress.org/apis/security/escaping/
  - https://developer.wordpress.org/reference/functions/add_query_arg/
  - https://developer.wordpress.org/reference/functions/the_title_attribute/
---
- **Escape late**: echoing options, post meta, user fields or request data without the output-context function → stored or reflected XSS. Fix: `esc_html()`, `esc_attr()`, `esc_url()`, `esc_textarea()`, `wp_kses_post()` at the point of output; input sanitizing does not replace this.
- **Translation helpers**: `_e()`, `__()`, `_x()` output translations unescaped, and `printf(__('Hi %s'), $name)` leaves `$name` raw. Fix: `esc_html_e()`, `esc_html__()`, `esc_attr__()`, escape the arguments.
- **Wrong context**: `esc_html()` in `href`/`src` still allows `javascript:`; `esc_js()` is only for inline event attributes, not `<script>` blocks; `esc_url_raw()` is for storage and redirects, not HTML. Fix: `esc_url()` for links, `wp_json_encode()` for script data.
- **Titles and excerpts**: `get_the_title()`, `the_title()`, `get_the_excerpt()` return filtered HTML that contributors control → in attributes use `the_title_attribute()` or `esc_attr()`.
- **add_query_arg()**: without an explicit URL it builds from `REQUEST_URI` and returns it unescaped → reflected XSS when echoed. Fix: wrap in `esc_url()`.
- **Custom kses rules**: `wp_kses()` allow-lists that permit `style`, event attributes or `data:`/`javascript:` protocols re-open XSS. Fix: start from `wp_kses_allowed_html('post')`.
