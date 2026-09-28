---
name: Context
description: React Context defects — unstable provider values, hot values in app-wide contexts, missing or misplaced providers, undefined values, React 19 provider syntax on React 18 and duplicate context objects.
priority: 60
activation:
  content:
    - "\\bcreateContext\\s*[<(]"
    - "\\buseContext\\s*\\("
    - "\\.Provider\\b"
    - "<\\w+Context\\b"
  examples:
    - "const ThemeContext = createContext<Theme>(defaultTheme);"
    - "const theme = useContext(ThemeContext);"
    - "<ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>"
    - "<UserContext value={user}>{children}</UserContext>"
sources:
  - https://react.dev/reference/react/useContext
  - https://react.dev/reference/react/createContext
  - https://react.dev/blog/2024/12/05/react-19
---
- **Unstable provider value**: `value={{ user, login }}` or inline callbacks → a new object each render re-renders every consumer (`memo` does not stop it). Fix: `useMemo`/`useCallback` the value or split state and actions.
- **Hot values in wide contexts**: keystrokes, scroll positions or timers in a context consumed app-wide → the whole tree re-renders per change. Fix: separate contexts or a store with selectors.
- **Missing provider**: a consumer outside its provider silently gets the `createContext` default (often `null` or no-op functions) → null crashes or actions that do nothing. Fix: a `useX` hook that throws without a provider.
- **Undefined value**: a provider whose `value` is omitted or misspelled (`<Ctx theme={…}>`) supplies `undefined`, not the default; a provider rendered in the same component as `useContext` is not seen by that call.
- **React 19 provider syntax**: `<Ctx value={…}>` is a provider only in React 19+; on 18 it renders the Consumer → crash ("render is not a function"). Fix: `<Ctx.Provider>` in code that must run on 18.
- **Duplicate context objects**: two copies of the module calling `createContext` (duplicate package versions, symlinked packages) → providers and consumers use different contexts → defaults everywhere.
