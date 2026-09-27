---
name: Blade output and XSS
description: Blade escaping gaps — {!! !!} on user data, raw translations with parameters, escaping that ignores URL/JS context, Str::markdown allowing raw HTML, HtmlString wrappers and Blade::render on user templates.
priority: 70
tags: [CWE-79, CWE-1336]
activation:
  files: ["**/*.blade.php"]
  content:
    - '\{!!|@js\s*\(|\bJs::from\s*\('
    - '\bStr::(?:markdown|inlineMarkdown)\s*\(|->(?:markdown|inlineMarkdown)\s*\('
    - '\bnew\s+HtmlString\s*\(|\bBlade::render\s*\('
sources:
  - https://laravel.com/docs/13.x/blade#displaying-data
  - https://laravel.com/docs/13.x/strings#method-str-markdown
  - https://laravel.com/docs/13.x/blade#rendering-inline-blade-templates
---
- **Raw echo**: `{!! $comment->body !!}` or `{!! $user->bio !!}` renders stored user HTML → stored XSS. Fix: `{{ }}`, or sanitize rich text with an HTML sanitizer before saving and rendering.
- **Raw translations**: `{!! __('welcome', ['name' => $user->name]) !!}` (used because the string contains markup) leaves the parameters unescaped → XSS through names and titles. Fix: escape parameters with `e()` first.
- **Context, not escaping**: `{{ }}` is `htmlspecialchars` → `href="{{ $url }}"` still runs `javascript:` URLs, and values inside `<script>`, inline handlers or template literals are unsafe. Fix: scheme allowlist, `@js($value)` or `Js::from()` for script data.
- **Markdown**: `Str::markdown($input)`/`inlineMarkdown()` allow raw HTML and unsafe links by default → XSS once echoed. Fix: `['html_input' => 'strip', 'allow_unsafe_links' => false]`.
- **Escape bypass**: wrapping user input in `new HtmlString(...)` or any `Htmlable` makes `{{ }}` print it raw.
- **Blade::render on user input**: user-editable templates passed to `Blade::render()` or compiled views are compiled to PHP → remote code execution. Fix: a sandboxed template engine or plain placeholder replacement.
