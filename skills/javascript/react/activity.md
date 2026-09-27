---
name: Activity (hidden UI)
description: <Activity> defects (React 19.2+) — media and iframes running while hidden, effects that do not survive hide/show, stale transient state when re-shown, hidden pre-rendering and 19.2.x hidden-tree bugs.
priority: 58
activation:
  content: ["<Activity\\b", "\\bActivity\\s*[,}]"]
  versions: { framework.react: ">=19.2" }
sources:
  - https://react.dev/reference/react/Activity
  - https://nextjs.org/docs/app/guides/preserving-ui-state
  - https://github.com/facebook/react/blob/main/CHANGELOG.md
---
- **Media keeps playing**: `<video>`, `<audio>` and `<iframe>` inside a hidden Activity keep playing or running — hiding only sets `display: none`. Fix: pause/stop in a `useLayoutEffect` cleanup.
- **Effects that don't survive hide/show**: hiding runs effect cleanups and showing re-runs setup; `didInit` ref guards, missing cleanups or setup-once subscriptions → dead or duplicated subscriptions after re-show. Fix: symmetric setup and cleanup.
- **Stale transient state**: open menus, dialogs, success messages and drafts are preserved and reappear when shown again, even after a user switch. Fix: reset transient state in a layout-effect cleanup; `key` per user.
- **Hidden pre-rendering**: hidden children still render at low priority and load Suspense data (`use()`) while their effects don't run → requests for tabs never opened; effect-based data is not prefetched.
- **19.2.x bugs**: portal content stays visible, `useSyncExternalStore` misses store changes and errors escape from hidden trees — fixed in 19.3. Fix: upgrade, or avoid portals/external stores inside hidden Activity.
