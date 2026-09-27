---
name: APIs removed in React 19
description: Code that breaks on React 19 — defaultProps on function components (silently ignored), removed ReactDOM render APIs, string refs, legacy context and module factories, and removed test utilities.
priority: 62
activation:
  content:
    - "\\.(?:defaultProps|propTypes)\\s*="
    - "\\bReactDOM\\.(?:render|hydrate)\\s*\\("
    - "\\b(?:unmountComponentAtNode|findDOMNode|renderToStaticNodeStream|createFactory)\\s*\\("
    - "react-dom/test-utils"
    - "\\b(?:contextTypes|childContextTypes|getChildContext)\\b"
    - "\\bref=['\"]\\w"
    - "\\bthis\\.refs\\b"
  versions: { framework.react: ">=19" }
sources:
  - https://react.dev/blog/2024/04/25/react-19-upgrade-guide
  - https://github.com/facebook/react/blob/main/CHANGELOG.md
---
- **defaultProps on function components**: ignored since 19 → props arrive `undefined` (crashes, wrong defaults), often inside shared UI kits; `propTypes` checks are silently skipped too. Fix: ES default parameters; classes still support `defaultProps`.
- **Removed ReactDOM APIs**: `ReactDOM.render`, `hydrate`, `unmountComponentAtNode`, `findDOMNode` and `renderToStaticNodeStream` no longer exist → TypeError at runtime, often in rarely run widgets, embeds or tests. Fix: `createRoot`/`hydrateRoot` (`react-dom/client`), `root.unmount()`, refs.
- **Legacy class features**: string refs (`ref="input"`, `this.refs`), legacy context (`contextTypes`, `childContextTypes`, `getChildContext`), `createFactory` and module-pattern factories are removed → undefined refs and context. Fix: callback/object refs, `static contextType`.
- **Test utilities**: `react-dom/test-utils` keeps only a deprecated `act` (import it from `react`), `react-test-renderer/shallow` is gone, and `React.act` is absent from production builds since 19.1.
