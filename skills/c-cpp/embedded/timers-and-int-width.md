---
name: Tick wraparound and 16-bit int
description: Embedded timing and integer-width bugs — deadline comparisons that break when tick counters wrap, tick values stored in narrow or signed types, tick-to-time conversions overflowing, and arithmetic overflowing a 16-bit int.
priority: 60
tags: [CWE-190, CWE-682]
activation:
  content:
    - '\b(?:millis|micros|HAL_GetTick|xTaskGetTickCount\w*|k_uptime_get\w*|esp_timer_get_time|time_us_(?:32|64)|osKernelGetTickCount)\s*\('
    - '\b\w*(?:[Tt]ick|TICK|[Tt]imeout|TIMEOUT|[Dd]eadline)\w*\s*[<>]=?\s*\w'
    - '\b\d{2,}\s*\*\s*\d{3,}\b|\b1\s*<<\s*(?:1[5-9]|2\d|3[01])\b'
sources:
  - https://docs.arduino.cc/language-reference/en/functions/time/millis/
  - https://docs.arduino.cc/language-reference/en/variables/data-types/int/
  - https://github.com/FreeRTOS/FreeRTOS-Kernel/blob/main/include/projdefs.h
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/integers-int/int30-c/
---
- **Wrapping deadlines**: `if (now >= start + timeout)` or `if (millis() > deadline)` break when the counter wraps (Arduino `millis()` ≈ 49.7 days, 32-bit µs counters ≈ 71 minutes, 16-bit ticks far sooner) → hangs or instant timeouts. Fix: unsigned elapsed time, `(uint32_t)(now - start) >= timeout`.
- **Narrow or signed tick storage**: tick or timestamp values kept in `int`, `long` or `uint16_t` → negative or truncated after 2^15/2^16/2^31 ticks. Fix: the counter's own unsigned type (`uint32_t`, `TickType_t`).
- **Conversion overflow**: `ticks * 1000 / rate` or `ms * rate` in 32-bit arithmetic overflows long before the counter wraps (FreeRTOS `pdMS_TO_TICKS` computes in 64-bit). Fix: 64-bit intermediates or divide first.
- **16-bit `int`**: on AVR and MSP430 `60 * 1000`, `seconds * 1000` or `1 << 15` overflow `int` (UB) before being stored in a 32-bit variable. Fix: `60000UL`, `1000UL * seconds`, `1UL << n`.
