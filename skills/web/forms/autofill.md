---
name: Autofill, passwords and one-time codes
description: Browser-autofill defects — autocomplete="off" hacks on login forms, wrong password tokens, split OTP inputs and paste blocking that fail WCAG 3.3.8, truncating maxlength on passwords and personal-data fields without input-purpose tokens.
priority: 54
tags: [WCAG-3.3.8, WCAG-1.3.5]
activation:
  content:
    - '\bauto[cC]omplete\s*='
    - 'type\s*=\s*[''"]password[''"]|\bone-time-code\b|\bOTPCredential\b'
    - '\bonPaste\b|\bonpaste\b|[''"]paste[''"]|\(paste\)|@paste\b'
    - '\bmax[lL]ength\b'
  examples:
    - '<input autoComplete="off" name="username" />'
    - '<input type="password" autoComplete="new-password" />'
    - '<input onPaste={(e) => e.preventDefault()} />'
    - '<input type="password" maxLength={12} />'
sources:
  - https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Turning_off_form_autocompletion
  - https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html
  - https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose.html
  - https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill
---
- **Fighting password managers**: `autocomplete="off"` on login forms (browsers ignore it for credentials) plus hacks — random `name`s, readonly-until-focus, decoy fields → autofill breaks, users pick weak passwords. Fix: `username` + `current-password`.
- **Wrong password tokens**: sign-up, reset or change-password fields marked `current-password` or unmarked → managers fill the old password and don't offer to generate or save. Fix: `new-password` on new and confirm fields.
- **Split OTP inputs**: one input per digit without paste handling or `autocomplete="one-time-code"` → SMS/keychain autofill and paste fill a single box (fails 3.3.8 AA). Fix: one input with `inputmode="numeric" autocomplete="one-time-code"`, or distribute pasted digits.
- **Blocking paste**: `paste` handlers calling `preventDefault` on password, confirm or email fields → forces transcription and breaks password managers (fails 3.3.8). Fix: allow paste.
- **Truncating passwords**: low `maxlength` on password inputs → pasted or generated passwords silently cut; stored credentials no longer work. Fix: no `maxlength` below 64.
- **No input purpose**: personal-data fields (name, email, tel, street address, postal code, birthday, `cc-*`) without matching `autocomplete` tokens (1.3.5 AA) → no autofill, more typing errors. Fix: correct tokens; `shipping`/`billing` sections for repeated groups.
