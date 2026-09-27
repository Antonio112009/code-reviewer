---
name: Cypress tests
description: Commands treated as values or awaited, non-retrying .then() assertions, fixed cy.wait, intercepts registered too late, reliance on state from earlier tests under testIsolation, and conditional DOM checks.
priority: 55
activation:
  files: ['**/cypress/**', '**/*.cy.{js,jsx,ts,tsx}', '**/cypress.config.*']
  content:
    - '\bcy\.[a-z]\w*\s*\('
    - '\bCypress\.(?:\$|Commands|env|on)\b'
sources:
  - https://docs.cypress.io/app/core-concepts/introduction-to-cypress
  - https://docs.cypress.io/app/core-concepts/retry-ability
  - https://docs.cypress.io/app/core-concepts/test-isolation
  - https://docs.cypress.io/app/core-concepts/best-practices
---
- **Commands are not values or promises**: `const btn = cy.get('button')` holds a chainer, not an element; `await cy.get()` or `async/await` breaks the command queue; plain JS (`if`, loops, variables) runs before queued commands execute. Fix: `.then()`, aliases (`.as()`), `.should()` chains.
- **`.then()` doesn't retry**: assertions inside `.then()` or on a captured jQuery element run once; only queries (`get`, `find`, `contains`) retry, actions don't → flaky failures and detached-element errors after re-renders. Fix: `.should(cb)` or chained assertions; re-query after actions.
- **Fixed waits**: `cy.wait(5000)` is slow and still flaky. Fix: `cy.intercept(…).as('save')` + `cy.wait('@save')`, or retrying assertions.
- **Intercept registered too late**: `cy.intercept()` after the `cy.visit()` or click that sends the request → the real network is hit and `cy.wait('@alias')` times out. Fix: register intercepts before the triggering command.
- **Relying on earlier tests**: with `testIsolation` (default since Cypress 12) the page, cookies and storage are cleared before each test → tests depending on a previous `it` fail alone or reordered; turning isolation off couples them. Fix: `cy.session()` for login, per-test setup.
- **Conditional DOM checks**: `if (Cypress.$('.modal').length)` reads the DOM once without retrying → the branch flips with timing. Fix: make the state deterministic (stubbed responses) instead of branching.
