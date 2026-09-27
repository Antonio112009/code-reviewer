---
name: React Native core pitfalls
description: Crashes and wrong layout common to any React Native screen — strings rendered outside <Text>, network images without a size, window dimensions cached at module scope and heavy logging in release builds.
priority: 60
sources:
  - https://reactnative.dev/docs/text
  - https://reactnative.dev/docs/images
  - https://reactnative.dev/docs/dimensions
  - https://reactnative.dev/docs/performance
---
- **Strings outside `<Text>`**: strings rendered directly in `<View>`/`<Pressable>` (`{user.name}`, `{error && error.message}`, `{' '}`, leftover literal text) → "Text strings must be rendered within a <Text> component" crash. Fix: wrap in `<Text>` (falsy numbers: see React core).
- **Network images without a size**: `<Image source={{ uri }}>` with no `width`/`height`, `aspectRatio` or flex sizing → rendered 0×0, the image never appears. Fix: give remote and data-URI images explicit dimensions.
- **Cached window size**: `Dimensions.get('window')` read at module scope or baked into `StyleSheet.create` → wrong layout after rotation, split-screen, foldables or font-scale changes. Fix: `useWindowDimensions()` during render.
- **Logging in release**: `console.log` of large objects in hot paths (`renderItem`, `onScroll`, gesture/animation callbacks, reducers) → JS-thread stalls and dropped frames in production. Fix: guard with `__DEV__` or strip with `babel-plugin-transform-remove-console`.
