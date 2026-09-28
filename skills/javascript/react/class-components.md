---
tier: full
name: Class component lifecycles
description: Class component defects — setState loops in componentDidUpdate, stale this.state, getDerivedStateFromProps overwriting local state, side effects in legacy lifecycles, missing teardown, unbound handlers and mutation with PureComponent.
priority: 55
activation:
  content:
    - "\\bextends\\s+(?:React\\.)?(?:Pure)?Component\\b"
    - "\\b(?:componentDidUpdate|componentWillUnmount|getDerivedStateFromProps|shouldComponentUpdate)\\b"
    - "\\bUNSAFE_component\\w+"
    - "\\bthis\\.setState\\s*\\("
  examples:
    - "class UserCard extends React.Component {"
    - "componentDidUpdate(prevProps) { if (prevProps.id !== this.props.id) this.load(); }"
    - "UNSAFE_componentWillMount() { this.load(); }"
    - "this.setState({ count: this.state.count + 1 });"
sources:
  - https://react.dev/reference/react/Component
  - https://legacy.reactjs.org/blog/2018/06/07/you-probably-dont-need-derived-state.html
---
- **Update loop**: `setState` in `componentDidUpdate` without comparing `prevProps`/`prevState` → endless updates ("Maximum update depth exceeded").
- **Stale this.state**: `this.setState({ n: this.state.n + 1 })` repeated, or reading `this.state` right after `setState` → lost updates. Fix: `setState(prev => …)`; follow-up logic in the callback or `componentDidUpdate`.
- **Derived state overwrite**: `getDerivedStateFromProps` (or `componentWillReceiveProps`) copying props unconditionally → wipes user edits on every parent render. Fix: compare with a stored previous prop, or make it controlled/keyed.
- **Side effects in legacy lifecycles**: subscriptions or requests in `UNSAFE_componentWillMount`, `UNSAFE_componentWillUpdate` or the constructor → may run several times or never commit under concurrent rendering. Fix: `componentDidMount`/`componentDidUpdate`.
- **Missing teardown**: listeners, timers or subscriptions from `componentDidMount` not removed in `componentWillUnmount` → leaks and updates on unmounted components.
- **Unbound handlers**: `onClick={this.handleClick}` with a prototype method → `this` is undefined when called. Fix: arrow class fields or bind in the constructor.
- **Mutation with PureComponent**: mutating state or props objects before `setState` → the shallow compare in `PureComponent`/`shouldComponentUpdate` sees no change → stale UI.
