---
name: RxJS subscriptions and teardown
description: Angular subscription leaks and duplicate work — subscribe without teardown, misplaced takeUntilDestroyed, nested subscribes, duplicated async-pipe requests, shareReplay without refCount and toSignal side effects.
priority: 62
activation:
  content:
    - "\\.subscribe\\s*\\("
    - "\\btakeUntil(?:Destroyed)?\\s*\\("
    - "\\btoSignal\\s*\\("
    - "\\bshareReplay\\s*\\("
    - "\\|\\s*async\\b"
    - "\\bnew\\s+(?:Behavior|Replay|Async)?Subject\\b"
  examples:
    - 'this.user$.subscribe(u => (this.user = u));'
    - 'this.user$.pipe(takeUntilDestroyed()).subscribe();'
    - 'readonly user = toSignal(this.user$);'
    - 'this.data$ = source$.pipe(shareReplay(1));'
    - '<div *ngIf="user$ | async as user">{{ user.name }}</div>'
    - 'private readonly destroy$ = new Subject<void>();'
sources:
  - https://angular.dev/ecosystem/rxjs-interop
  - https://angular.dev/ecosystem/rxjs-interop/take-until-destroyed
  - https://github.com/ReactiveX/rxjs/blob/7.x/src/internal/operators/shareReplay.ts
  - https://github.com/cartant/eslint-plugin-rxjs/blob/main/docs/rules/no-unsafe-takeuntil.md
---
- **Unbounded subscribe**: `.subscribe()` on long-lived sources (`valueChanges`, `router.events`, store selectors, `interval`, `fromEvent`, Subjects) in components without teardown → leaks, handlers firing after destroy. Fix: `takeUntilDestroyed()`, `async` pipe or `toSignal`.
- **takeUntilDestroyed placement**: called in `ngOnInit`/callbacks without a `DestroyRef` → NG0203; placed before `switchMap`/`mergeMap` → inner subscriptions outlive the component. Fix: pass `this.destroyRef`; keep it last.
- **Nested subscribe**: subscribing inside another `subscribe` callback → uncancelled inner streams, races and leaks. Fix: flatten with `switchMap`/`concatMap`.
- **Duplicate requests**: one cold HTTP observable used by several `| async` pipes or subscribers → one request per subscriber. Fix: a single `@if (data$ | async; as data)`, `toSignal`, or `shareReplay`.
- **shareReplay forever**: `shareReplay(1)` (refCount defaults to `false`) on long-lived sources → source stays subscribed after all consumers leave; cached user data survives logout. Fix: `shareReplay({ bufferSize: 1, refCount: true })`; reset on logout.
- **toSignal surprises**: `toSignal()` subscribes immediately (side effects run even if never read) and rethrows source errors on every read → template crashes. Fix: `catchError` before `toSignal`; give an `initialValue`.
- **Root-service subscriptions**: subscriptions held by `providedIn: 'root'` services never end → per-user streams and caches leak across sessions. Fix: scope them to components or clear on logout.
