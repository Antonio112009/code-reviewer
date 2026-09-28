---
name: XML parsers and XXE
description: XML External Entity and DTD attacks through JAXP and third-party parsers at their permissive defaults — DocumentBuilderFactory, SAXParserFactory, XMLInputFactory, TransformerFactory, SchemaFactory, JAXB, dom4j and JDOM.
priority: 76
tags: [CWE-611, CWE-776, A02:2025]
activation:
  content:
    - '\b(?:DocumentBuilderFactory|SAXParserFactory|XMLInputFactory|XMLReader|XMLReaderFactory|TransformerFactory|SchemaFactory|SAXReader|SAXBuilder|Unmarshaller|JAXBContext|XmlMapper)\b'
  examples:
    - 'DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();'
sources:
  - https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.xml/module-summary.html
  - https://docs.oracle.com/en/java/javase/17/security/java-api-xml-processing-jaxp-security-guide.html
---
- **DOM/SAX defaults**: `DocumentBuilderFactory`, `SAXParserFactory`, `XMLReader`, dom4j `SAXReader` and JDOM `SAXBuilder` process DTDs by default (`jdk.xml.dtd.support=allow`) → XXE file reads, SSRF, billion-laughs DoS. Fix: enable `http://apache.org/xml/features/disallow-doctype-decl`.
- **StAX**: `XMLInputFactory` (also used by Jackson `XmlMapper`) needs `SUPPORT_DTD = false` and `IS_SUPPORTING_EXTERNAL_ENTITIES = false`, set together.
- **Transformers and schemas**: `TransformerFactory`, `SchemaFactory` and `Validator` need `ACCESS_EXTERNAL_DTD`/`ACCESS_EXTERNAL_STYLESHEET`/`ACCESS_EXTERNAL_SCHEMA` set to `""`; untrusted XSLT can call extension functions → code execution. Fix: trusted stylesheets only.
- **Secure processing is not enough**: `FEATURE_SECURE_PROCESSING` bounds resource use but does not reliably block external entities across implementations. Fix: the explicit features above.
- **JAXB**: `Unmarshaller.unmarshal(InputStream/File/URL)` uses an internal, unhardened parser. Fix: unmarshal from a hardened `XMLStreamReader` or `SAXSource`.
- **Order and scope**: features set after `newDocumentBuilder()`/`newSAXParser()`, on another factory instance, or undone by `setXIncludeAware(true)` → the parser stays vulnerable. Fix: configure the factory before creating parsers.
