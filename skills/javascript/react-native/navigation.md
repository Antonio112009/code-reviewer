---
name: React Navigation lifecycle and params
description: React Navigation 7 defects — work running on unfocused (still mounted) screens, useFocusEffect misuse, v7 navigate semantics, nested navigation, non-serializable or mutated params, navigating before the container is ready and unguarded unsaved edits.
priority: 62
activation:
  content:
    - '@react-navigation/'
    - '\buse(?:Navigation|FocusEffect|IsFocused|PreventRemove)\b'
    - '\bnavigation\.(?:navigate|push|popTo|replace|reset|setParams|addListener)\('
    - '\b(?:NavigationContainer|navigationRef)\b|\bcreate\w*Navigator\('
  examples:
    - "import { useNavigation } from '@react-navigation/native';"
    - "navigation.navigate('Profile', { userId });"
    - 'const Stack = createNativeStackNavigator();'
sources:
  - https://reactnavigation.org/docs/navigation-lifecycle
  - https://reactnavigation.org/docs/use-focus-effect
  - https://reactnavigation.org/docs/upgrading-from-6.x
  - https://reactnavigation.org/docs/params
---
- **Work on unfocused screens**: timers, polling, location, sockets, camera or media started in `useEffect` keep running after navigating away (stack and tab screens stay mounted) → battery drain, stale writes. Fix: `useFocusEffect` with cleanup.
- **useFocusEffect misuse**: inline callback not wrapped in `useCallback` → effect and cleanup rerun on every render while focused (refetch loops); an `async` callback returns a promise instead of a cleanup. Fix: `useCallback`, async function inside.
- **v7 navigate semantics**: `navigate('Previous')` no longer goes back — it pushes a new copy unless that screen is focused; `navigate({ key })` is unsupported → duplicate screens and broken back stacks after upgrading. Fix: `popTo`, `getId`.
- **Nested targets**: `navigate('ChildScreen')` into another navigator without `{ screen }` fails in v7 (unless `navigationInChildEnabled`). Fix: `navigate('Parent', { screen: 'Child', params })`.
- **Params misuse**: functions, class instances or whole entities in `params` → broken deep links and state persistence, stale copies; mutating `route.params` throws in dev (frozen state). Fix: pass ids; update with `setParams`.
- **Navigating too early**: `navigationRef.navigate` from notification or auth listeners at startup before `isReady()`/`onReady` → action dropped or error. Fix: queue until ready.
- **Unsaved edits discarded**: forms guarding only the Android back button (BackHandler) → header back or swipe gesture drops edits. Fix: `usePreventRemove` / `beforeRemove`.
