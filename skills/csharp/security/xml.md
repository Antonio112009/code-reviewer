---
name: XML, XSLT and XPath
description: XML processing vulnerabilities in .NET — DTD processing re-enabled with a resolving XmlResolver (XXE/SSRF), entity-expansion DoS, XSLT with document()/scripts, XPath built from input and XML loaded from user URLs.
priority: 72
tags: [CWE-611, CWE-776, CWE-643, A05:2025]
activation:
  content:
    - '\bDtdProcessing\b|\bProhibitDtd\b|\bXmlUrlResolver\b|\bXmlResolver\b'
    - '\bXslCompiledTransform\b|\bXsltSettings\b'
    - '\bXmlTextReader\b|\bXmlDocument\b|\bXmlReader\.Create\(|\bXDocument\.(?:Load|Parse)\('
    - '\.(?:SelectNodes|SelectSingleNode|XPathSelectElements?|XPathEvaluate)\('
  examples:
    - 'var settings = new XmlReaderSettings { XmlResolver = new XmlUrlResolver(), DtdProcessing = DtdProcessing.Parse };'
    - 'transform.Load(userStylesheetPath, XsltSettings.TrustedXslt, null);'
    - 'var doc = new XmlDocument(); doc.LoadXml(userXml);'
    - 'var node = doc.SelectSingleNode(xpath);'
sources:
  - https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca3075
  - https://learn.microsoft.com/en-us/dotnet/standard/data/xml/xslt-security-considerations
  - https://learn.microsoft.com/en-us/dotnet/api/system.xml.xmlreadersettings.maxcharactersfromentities
  - https://github.com/dotnet/runtime/blob/main/src/libraries/System.Private.Xml/src/System/Xml/Core/LocalAppContextSwitches.cs
---
- **XXE re-enabled**: .NET Core uses an `XmlResolver` only when set explicitly (or via `Switch.System.Xml.AllowDefaultResolver`) — assigning `new XmlUrlResolver()` on `XmlReaderSettings`, `XmlDocument` or `XmlTextReader` (parses DTDs by default) for untrusted XML → file disclosure, SSRF. Fix: no resolver, `DtdProcessing.Prohibit`.
- **Entity expansion**: `DtdProcessing.Parse` with `MaxCharactersFromEntities = 0` (unlimited; default 10 million characters) or no `MaxCharactersInDocument` → billion-laughs/huge-document memory and CPU exhaustion. Fix: keep DTDs prohibited, keep limits.
- **.NET Framework targets**: multi-targeted libraries get resolving `XmlDocument`/`XmlTextReader` defaults on .NET Framework < 4.5.2. Fix: set options explicitly.
- **XSLT**: `XslCompiledTransform.Load` of untrusted stylesheets, `XsltSettings.TrustedXslt`/`EnableDocumentFunction = true` with a resolving `XmlUrlResolver` → file read/SSRF via `document()`; `msxsl:script` runs code on .NET Framework. Fix: `XsltSettings.Default`, `null` resolver, no user XSLT.
- **XPath injection**: `SelectNodes`/`SelectSingleNode`/`XPathEvaluate` with concatenated input (`"//user[@name='" + name + "']"`) → authentication bypass, data extraction. Fix: LINQ to XML comparisons or strict allowlists.
- **Loading from user URLs**: `XDocument.Load(userUrl)`/`XmlReader.Create(userUrl)` fetch remote or `file://` resources → SSRF/local file read. Fix: load only streams you opened.
