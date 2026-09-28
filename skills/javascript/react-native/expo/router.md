---
name: Expo Router
description: expo-router defects — protected routes mistaken for access control, navigating before the root layout mounts, URL params trusted or mistyped, global search params re-rendering every screen, and reserved param names.
priority: 62
activation:
  content:
    - 'expo-router'
    - '\buse(?:Local|Global)SearchParams\b|\bStack\.Protected\b|<Redirect\b'
    - '\brouter\.(?:push|replace|navigate|dismissTo|setParams)\('
  examples:
    - "import { useLocalSearchParams } from 'expo-router';"
    - "router.push('/profile');"
  files: ['**/app/**/_layout.{js,jsx,ts,tsx}']
sources:
  - https://docs.expo.dev/router/advanced/protected/
  - https://docs.expo.dev/router/advanced/authentication/
  - https://docs.expo.dev/router/reference/url-parameters/
---
- **Guards are not security**: `Stack.Protected`, `<Redirect>` or layout checks only hide screens client-side; on web the route's HTML/JS stays downloadable and APIs callable. Fix: authorize data access on the server.
- **Navigating before mount**: `router.replace('/login')` from a root `_layout` effect or auth listener before the navigator renders → "navigate before mounting the Root Layout" error or flashing redirects. Fix: render `<Slot/>`/`<Stack>` first, keep the splash (`SplashScreen.preventAutoHideAsync()`) until auth loads, prefer `Stack.Protected`.
- **Params are untrusted strings**: `useLocalSearchParams()` values are `string | string[]` taken from the URL (deep links) → `Number(id)` is NaN, arrays where strings are expected, ids used for writes unchecked. Fix: validate and narrow.
- **Global params**: `useGlobalSearchParams` in screens re-renders every mounted screen on each URL change → jank, background screens reacting to foreign params. Fix: `useLocalSearchParams`.
- **Reserved names**: route or search params named `screen`, `params`, `initial` or `state` collide with router internals → wrong screen or params. Fix: rename.
