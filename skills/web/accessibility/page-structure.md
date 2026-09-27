---
name: Page language, titles and structure
description: Page-level WCAG failures — missing or wrong lang, SPA routes that never update the title, no landmarks or skip link, styled text instead of headings and data tables without header semantics.
priority: 50
tags: [WCAG-3.1.1, WCAG-2.4.2, WCAG-2.4.1, WCAG-1.3.1]
activation:
  content:
    - '<html\b|<title\b|\bdocument\.title\b|\blang\s*='
    - '<(?:main|nav|header|footer|h[1-6]|table|th|caption)\b|\brole\s*=\s*[{''"]*(?:main|navigation|heading|table|grid)\b'
    - '<Head\b|<svelte:head>|\bTitle\.setTitle\(|\buseHead\(|\bgenerateMetadata\b'
sources:
  - https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html
  - https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html
  - https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html
  - https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html
---
- **Missing or wrong `lang`**: root `<html>` without `lang` (or a hard-coded one in localized apps), foreign-language passages without `lang` → screen readers use the wrong voice and pronunciation. Fix: set `lang` from the active locale.
- **Static titles in SPAs**: client-side route changes that never update `document.title`/`<title>` → every view announced with the same title. Fix: per-route titles.
- **No landmarks or skip link**: layouts without `<main>`, `<nav>`, `<header>` and no "skip to content" link → keyboard users tab through the whole header on every page (2.4.1). Fix: landmarks plus a skip link.
- **Fake headings**: section titles as styled `div`/`span`/bold text, or `h1`–`h6` picked for font size → heading navigation unusable. Fix: real headings in logical order, styled with CSS.
- **Tables without semantics**: data grids built from `div`s without `role="table|grid"` and row/cell roles, or `<table>` without `<th>`/`scope`/`<caption>` → cells read without their headers. Fix: native table markup.
