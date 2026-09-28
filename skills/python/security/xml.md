---
name: XML parsing
description: Entity-expansion DoS in stdlib parsers (Expat older than 2.7.2), lxml external entities (defaults changed in lxml 5.0 and 6.1.x), user-supplied XSLT/XInclude, xmlrpc decompression bombs and lxml's HTML cleaner used as an XSS boundary.
priority: 76
tags: [CWE-611, CWE-776, CWE-918, OWASP-A02]
activation:
  content:
    - "\\bxml\\.(?:etree|dom|sax)\\b|\\b(?:ElementTree|minidom|pulldom|expatbuilder)\\b|\\bxmlrpc\\b|\\bdefusedxml\\b"
    - "\\blxml\\b|\\betree\\.(?:parse|fromstring|XML|XMLParser|iterparse|XSLT)\\s*\\(|\\b(?:resolve_entities|load_dtd|no_network|huge_tree)\\s*="
    - "\\b(?:Cleaner|clean_html)\\s*\\(|\\blxml_html_clean\\b"
  examples:
    - 'tree = xml.etree.ElementTree.parse(upload)'
    - 'parser = etree.XMLParser(resolve_entities=True)'
    - 'clean = Cleaner().clean_html(user_html)'
sources:
  - https://docs.python.org/3/library/xml.html#xml-security
  - https://github.com/lxml/lxml/blob/master/CHANGES.txt
  - https://lxml.de/FAQ.html#how-do-i-use-lxml-safely-as-a-web-service-endpoint
  - https://github.com/fedora-python/lxml_html_clean/security/advisories/GHSA-4jhm-jv67-739f
---
- **Entity-expansion DoS**: `ElementTree`, `minidom`, `sax`, `pulldom` and `xmlrpc` on untrusted XML are exposed to billion-laughs, quadratic blowup and large-token attacks when the linked Expat is older than 2.7.2 (system builds vary) → CPU/memory exhaustion. Fix: `defusedxml`, size limits, check `pyexpat.EXPAT_VERSION`.
- **lxml external entities (XXE)**: lxml < 5.0 resolves external entities by default; `iterparse()` and `ETCompatXMLParser` did until 6.1.0 (CVE-2026-41066) and external parameter entities until 6.1.3; `resolve_entities=True`, `load_dtd=True`, `no_network=False` re-enable them → file read, SSRF. Fix: current lxml plus `XMLParser(resolve_entities=False, no_network=True)`.
- **User-supplied XSLT or XInclude**: applying uploaded stylesheets (`etree.XSLT`) or processing XInclude reads local files and URLs. Fix: never accept stylesheets from users; `XSLTAccessControl.DENY_ALL`.
- **Huge documents**: `huge_tree=True` lifts libxml2's safety limits, and `xmlrpc` accepts compressed bodies (decompression bombs). Fix: cap request size before parsing; keep limits on.
- **HTML "cleaning" as a security boundary**: `lxml.html.clean.Cleaner` (now the separate `lxml_html_clean` package) has had repeated bypasses → XSS. Fix: an allowlist sanitizer such as `nh3`.
