---
name: FreeRTOS tasks and interrupts
description: FreeRTOS API misuse — task APIs called from ISRs, ISR priorities above configMAX_SYSCALL_INTERRUPT_PRIORITY, missing yield from ISR, mutexes in interrupts, stack depth in words, pdMS_TO_TICKS truncation and ignored queue results.
priority: 65
tags: [CWE-667, CWE-362, CWE-252]
activation:
  content:
    - '\b(?:xTask|vTask|ulTask|uxTask|xQueue|vQueue|uxQueue|xSemaphore|vSemaphore|xEventGroup|xTimer|xStreamBuffer|xMessageBuffer)\w*\s*\('
    - '\b(?:portYIELD_FROM_ISR|portEND_SWITCHING_ISR|taskENTER_CRITICAL\w*|taskEXIT_CRITICAL\w*|pdMS_TO_TICKS|configMAX_(?:SYSCALL|API_CALL)_INTERRUPT_PRIORITY)\b'
  examples:
    - 'xQueueSend(xQueue, &item, portMAX_DELAY);'
    - 'portYIELD_FROM_ISR(xHigherPriorityTaskWoken);'
sources:
  - https://github.com/FreeRTOS/FreeRTOS-Kernel-Book/blob/main/ch07.md
  - https://github.com/FreeRTOS/FreeRTOS-Kernel-Book/blob/main/ch08.md
  - https://github.com/FreeRTOS/FreeRTOS-Kernel-Book/blob/main/ch04.md
  - https://github.com/FreeRTOS/FreeRTOS-Kernel/blob/main/include/projdefs.h
---
- **Task APIs in ISRs**: `xQueueSend`, `xSemaphoreGive`, `taskENTER_CRITICAL` or any API without `FromISR` called from an interrupt → corrupted kernel state. Fix: `…FromISR` variants.
- **Interrupt priorities**: ISRs using `FromISR` APIs need a logical priority at or below `configMAX_SYSCALL_INTERRUPT_PRIORITY` (numerically ≥ on Cortex-M); the default priority 0 is never valid → random corruption. Fix: set NVIC priorities; enable `configASSERT`.
- **Missing yield from ISR**: `xHigherPriorityTaskWoken` not initialized to `pdFALSE`, not passed, or not given to `portYIELD_FROM_ISR` → the woken task runs a tick late. Fix: init, pass, yield.
- **Mutexes and interrupts**: mutexes used from ISRs, or tasks masking interrupts with `__disable_irq` (breaks the critical-section nesting count) → undefined kernel behaviour. Fix: semaphores or task notifications; `taskENTER_CRITICAL`.
- **Stack depth in words**: `xTaskCreate` counts words, not bytes; big locals, `printf` or deep calls overflow silently. Fix: measure with `uxTaskGetStackHighWaterMark`; `configCHECK_FOR_STACK_OVERFLOW` 2.
- **Tick conversions**: `pdMS_TO_TICKS(ms)` truncates, so short delays and timeouts become 0 ticks; periodic loops using `vTaskDelay` drift. Fix: round up; `xTaskDelayUntil` for periods.
- **Ignored results**: `xQueueSend`/`xSemaphoreTake` with finite timeouts failing unchecked → dropped data or unprotected access. Fix: check every result.
