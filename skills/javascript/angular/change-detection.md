---
name: Change detection, OnPush and zoneless
description: Stale views under OnPush (default for new components since v22) and zoneless change detection (default since v21) — mutated inputs, updates outside Angular notifications, NgZone APIs that never fire and zoneless SSR stability.
priority: 64
activation:
  content:
    - "\\bChangeDetection(?:Strategy|Ref)\\b"
    - "\\b(?:markForCheck|detectChanges)\\s*\\("
    - "\\bNgZone\\b"
    - "\\bprovide(?:Experimental)?Zone(?:less)?ChangeDetection\\b"
    - "\\b(?:onMicrotaskEmpty|onStable|onUnstable|runOutsideAngular|PendingTasks)\\b"
    - "\\bngAfterView(?:Init|Checked)\\s*\\("
    - "@Component\\s*\\("
    - "\\bset(?:Timeout|Interval)\\s*\\("
    - "\\.(?:push|splice|unshift|sort|reverse)\\s*\\("
  examples:
    - 'changeDetection: ChangeDetectionStrategy.OnPush,'
    - 'this.cdr.markForCheck();'
    - 'constructor(private zone: NgZone) {}'
    - 'providers: [provideZonelessChangeDetection()],'
    - 'this.zone.runOutsideAngular(() => this.poll());'
    - 'ngAfterViewInit() { this.checkLayout(); }'
    - '@Component({ selector: ''app-list'' })'
    - 'setTimeout(() => (this.total = compute()), 0);'
    - 'this.items().push(newItem);'
sources:
  - https://angular.dev/guide/zoneless
  - https://angular.dev/best-practices/skipping-subtrees
  - https://github.com/angular/angular/blob/main/CHANGELOG.md
  - https://angular.dev/guide/components/lifecycle
---
- **Mutated inputs under OnPush**: parents mutating arrays/objects passed to OnPush children (components without `changeDetection` are OnPush since v22; `Eager` is the old default) → children never re-render. Fix: new references or signals.
- **Updates outside notifications**: plain fields changed in `setTimeout`, promise or `subscribe` callbacks, or third-party events under OnPush/zoneless → stale view. Fix: signals, `async` pipe or `markForCheck()`.
- **Zone assumptions**: v21+ apps without `provideZoneChangeDetection()` are zoneless; `NgZone.onStable`/`onMicrotaskEmpty`/`onUnstable` never emit and `isStable` is always true. Fix: `afterNextRender`/`afterEveryRender`, signals.
- **Zoneless SSR stability**: async work not tracked by HttpClient/resources (timers, custom fetch, SDK calls) → HTML serialized before data arrives. Fix: `PendingTasks.run()`/`add()` (v20+ `run` returns no result; handle rejections).
- **Reactive forms under zoneless**: `setValue`/`patchValue`/`FormArray.push` don't schedule change detection → stale bound views. Fix: bind through signals/`async` pipe or `markForCheck()`.
- **ExpressionChanged**: state set in `ngAfterViewInit`/`ngAfterViewChecked` or by getters with side effects → NG0100 in dev, inconsistent UI in prod. Fix: `computed`, or defer via `afterNextRender`.
- **Manual CD in hot paths**: `detectChanges()` in loops, scroll or mousemove handlers → heavy synchronous re-rendering. Fix: batch state changes; rely on signals.
