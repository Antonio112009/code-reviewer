---
name: Reactive forms
description: Angular reactive-form defects — disabled values dropped on submit, reset() to null, valueChanges feedback loops, per-keystroke async validators and silently ignored patchValue keys.
priority: 60
activation:
  content:
    - "\\b(?:FormGroup|FormControl|FormArray|FormRecord|FormBuilder|NonNullableFormBuilder)\\b"
    - "\\b(?:valueChanges|statusChanges|getRawValue|patchValue|updateValueAndValidity)\\b"
    - "\\bformControlName\\b|\\[formGroup\\]"
    - "from ['\"]@angular/forms['\"]"
  examples:
    - 'form = new FormGroup({ name: new FormControl('''') });'
    - 'this.form.valueChanges.subscribe(v => this.save(v));'
    - '<form [formGroup]="form" (ngSubmit)="submit()">'
    - 'import { FormBuilder } from ''@angular/forms'';'
sources:
  - https://angular.dev/guide/forms/typed-forms
  - https://angular.dev/guide/forms/reactive-forms
  - https://angular.dev/api/forms/AbstractControl
---
- **Disabled fields dropped**: submitting `form.value` omits disabled controls (typed as `Partial`) → saved records lose those fields or reset them server-side. Fix: `getRawValue()`.
- **reset() to null**: `reset()` sets controls to `null` unless created with `nonNullable: true` / `fb.nonNullable` → `null` sent to APIs, crashes on `.trim()`. Fix: non-nullable controls or explicit reset values.
- **Feedback loop**: `setValue`/`patchValue`/`updateValueAndValidity` inside a `valueChanges` subscription of the same control or group → infinite loop or duplicate requests. Fix: `{ emitEvent: false }`, `distinctUntilChanged`.
- **Async validator per keystroke**: async validators with the default `updateOn: 'change'` → one HTTP call per keystroke. Fix: `updateOn: 'blur'` or debounce inside the validator.
- **Silent patchValue**: `patchValue` ignores keys that match no control (typos, renamed fields), while `setValue` throws on missing ones → data silently not applied. Fix: typed forms; `setValue` for full updates.
