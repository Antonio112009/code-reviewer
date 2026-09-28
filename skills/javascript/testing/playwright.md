---
name: Playwright tests
description: Non-retrying checks instead of web-first assertions, missing awaits, hard waits and discouraged load states, waits registered after the triggering action, locator.all() races, strictness workarounds and state shared between tests.
priority: 55
activation:
  files: ['**/playwright.config.*']
  content:
    - '\bfrom\s*[''"]@playwright/test[''"]'
    - '\bpage\.(?:goto|click|fill|locator|getBy\w+|waitFor\w*|evaluate)\s*\('
    - '\.(?:isVisible|isHidden|textContent|innerText|count|all)\s*\(\s*\)'
    - '\btest\.describe\.(?:serial|configure)\b|\bstorageState\b|\bfullyParallel\b'
  examples:
    - 'import { test, expect } from ''@playwright/test'';'
    - 'await page.goto(''/login'');'
    - 'const visible = await loc.isVisible();'
    - 'test.describe.serial(''suite'', () => {});'
sources:
  - https://playwright.dev/docs/best-practices
  - https://playwright.dev/docs/test-assertions
  - https://playwright.dev/docs/api/class-locator#locator-all
  - https://playwright.dev/docs/api/class-page#page-wait-for-navigation
---
- **Non-retrying checks**: `expect(await loc.isVisible()).toBe(true)`, `expect(await loc.textContent()).toBe(…)` or `await loc.count()` snapshot the page once → races with rendering, flaky. Fix: web-first assertions (`await expect(loc).toBeVisible()`, `toHaveText`, `toHaveCount`).
- **Missing `await`**: an un-awaited action or `expect(locator).toBeVisible()` is a promise nobody waits for → the test moves on or ends first; failures show up as "Target closed" or never. Fix: await every action and web assertion.
- **Hard waits and load states**: `page.waitForTimeout()` (meant for debugging), `waitForLoadState('networkidle')` (discouraged) and the deprecated, racy `page.waitForNavigation()` → slow and flaky. Fix: `waitForURL`, `waitForResponse`, assertions.
- **Waiting after the trigger**: `await btn.click(); await page.waitForResponse(url)` can miss a fast response → timeout. Fix: start the wait first (`const r = page.waitForResponse(url); await btn.click(); await r`).
- **`locator.all()` and handles**: `all()` doesn't wait and returns whatever matches right now; `ElementHandle`s are discouraged as racy. Fix: `await expect(list).toHaveCount(n)` before iterating.
- **Strictness bypass and shared state**: silencing strict-mode violations with `.first()`/`.nth()` acts on whichever match renders first; a `page` from `beforeAll`, `describe.serial` chains or shared accounts under `fullyParallel` make tests order-dependent. Fix: unique locators, per-test fixtures and data.
