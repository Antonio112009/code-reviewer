---
name: WKWebView bridges and content
description: WKWebView risks — script message handlers trusting any frame, JavaScript built by string interpolation, message handlers retaining their owner, broad file read access, unrestricted navigation and inspectable production web views.
tags: [CWE-749, CWE-79, CWE-94]
activation:
  content:
    - '\bWK(?:WebView|UserContentController|ScriptMessage\w*|NavigationDelegate|UIDelegate|WebViewConfiguration|FrameInfo)\b|\buserContentController\b'
    - '\.(?:evaluateJavaScript|callAsyncJavaScript|loadFileURL|loadHTMLString|addUserScript)\(|\bdecidePolicyFor\b|\bisInspectable\b'
sources:
  - https://developer.apple.com/documentation/webkit/wkscriptmessage/frameinfo
  - https://developer.apple.com/documentation/webkit/wkwebview/callasyncjavascript(_:arguments:in:in:completionhandler:)
  - https://developer.apple.com/documentation/webkit/wkwebview/loadfileurl(_:allowingreadaccessto:)
  - https://developer.apple.com/documentation/webkit/wkwebview/isinspectable
---
- **Bridge trusts any frame**: a `WKScriptMessageHandler` acting on `message.body` without checking `message.frameInfo.securityOrigin` and `isMainFrame` → any loaded page, iframe or ad can call native features (tokens, payments, files).
- **Interpolated JavaScript**: `evaluateJavaScript("show('\(text)')")` with untrusted strings → script injection into the page. Fix: `callAsyncJavaScript(_:arguments:in:in:)` (iOS 14+) passing values as arguments.
- **Handler retain cycle**: `userContentController.add(self, name:)` retains the handler strongly → the owner of the web view never deallocates. Fix: remove handlers on teardown or register a weak proxy.
- **Broad file access**: `loadFileURL(_:allowingReadAccessTo:)` granting Documents or the app container → page scripts can read unrelated local files. Fix: grant only the file or a dedicated folder.
- **Unrestricted navigation**: no `decidePolicyFor` allowlist in views that inject tokens or expose a bridge → phishing pages, `javascript:` or custom-scheme URLs gain the same powers. Fix: allowlist hosts; open others externally.
- **Inspectable in release**: `isInspectable = true` (iOS 16.4+) shipped to production lets anyone with Safari's Web Inspector read content and drive the bridge.
