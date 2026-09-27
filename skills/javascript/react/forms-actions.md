---
name: React 19 Actions and forms
description: React 19 form Action defects — wrong useActionState signature, inputs reset after error results, dispatches outside transitions, throwing actions, misplaced useFormStatus and useOptimistic misuse.
priority: 64
activation:
  content:
    - "\\buse(?:ActionState|FormStatus|Optimistic|FormState)\\s*\\("
    - "\\b(?:action|formAction)=\\{"
    - "\\brequestFormReset\\s*\\("
  versions: { framework.react: ">=19" }
sources:
  - https://react.dev/reference/react/useActionState
  - https://react.dev/reference/react-dom/components/form
  - https://react.dev/reference/react-dom/hooks/useFormStatus
  - https://react.dev/reference/react/useOptimistic
---
- **Wrong action signature**: a `useActionState` action treating its first parameter as `FormData` — it is the previous state; the payload comes second → `.get` on state throws. Fix: `(prevState, formData)`.
- **Inputs wiped after errors**: once a form `action` resolves — even when it returns a validation error — React resets uncontrolled fields → users retype everything. Fix: return submitted values and render them as `defaultValue`, or use controlled fields.
- **Dispatch outside a transition**: the `useActionState` dispatch or a Server Function called from `onClick`/effects without `startTransition` → `isPending` never becomes true and React logs an error. Fix: wrap it, or pass it to `action`/`formAction`.
- **Throwing actions**: a thrown error cancels all queued `useActionState` dispatches and renders the nearest Error Boundary (none → the tree unmounts). Fix: return error state for expected failures.
- **useFormStatus placement**: called in the component that renders the `<form>` → `pending` is always false; it only reads a parent form. Fix: call it in a child such as the submit button.
- **Optimistic update outside an action**: a `useOptimistic` setter called outside an Action/`startTransition` → warning and instant revert; absolute values (`set(count + 1)`) go stale with overlapping actions. Fix: call it inside the action, reducer form.
- **`method` ignored**: with a function `action`/`formAction` the form is always dispatched to that function as POST; `method="get"` query-string behaviour is gone.
