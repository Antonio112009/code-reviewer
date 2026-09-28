---
name: ISR shared state
description: Interrupt/main-loop sharing bugs — non-volatile flags, torn multi-byte reads, read-modify-write races, critical sections that re-enable interrupts too early, heavy work in ISRs and pending flags never cleared.
priority: 65
tags: [CWE-362, CWE-366, CWE-667]
activation:
  content:
    - '\bISR\s*\(|\b\w+_IRQHandler\s*\(|__attribute__\s*\(\(\s*(?:interrupt|isr|signal)\b|\bIRAM_ATTR\b|\battachInterrupt\s*\('
    - '\b(?:__disable_irq|__enable_irq|__get_PRIMASK|__set_PRIMASK|cli|sei|noInterrupts|interrupts|irq_lock|irq_unlock)\s*\('
    - '\bATOMIC_BLOCK\s*\(|\bvolatile\s+(?:u?int(?:8|16|32|64)_t|bool|unsigned|int|long)\s+\w+'
  examples:
    - 'ISR(TIMER1_COMPA_vect) {'
    - 'cli();'
    - 'volatile uint8_t flag = 0;'
sources:
  - https://avrdudes.github.io/avr-libc/avr-libc-user-manual/group__util__atomic.html
  - https://arm-software.github.io/CMSIS_6/latest/Core/group__Core__Register__gr.html
  - https://en.cppreference.com/w/c/language/volatile
---
- **Non-volatile shared flags**: variables set in an ISR and polled in the main loop without `volatile` → the loop never sees the change once optimized. Fix: `volatile`, plus the rules below for multi-byte data.
- **Torn reads**: multi-byte values shared with an ISR (16/32-bit counters on 8-bit AVR, 64-bit values on Cortex-M, structs) accessed in pieces → inconsistent values. Fix: copy inside a critical section (`ATOMIC_BLOCK`), or re-read until stable.
- **Read-modify-write races**: `count++`, `flags |= X` in main code on variables the ISR also changes → lost updates, even with `volatile`. Fix: disable interrupts around the update, or atomic instructions.
- **Critical-section nesting**: `__disable_irq(); … __enable_irq();` (or `cli`/`sei`, `ATOMIC_FORCEON`) in code that may run with interrupts already off → re-enabled too early. Fix: save/restore PRIMASK or SREG (`ATOMIC_RESTORESTATE`).
- **Heavy ISRs**: `printf`, `malloc`, flash writes, delays, blocking waits or non-reentrant calls in interrupt handlers → missed interrupts, deadlocks, heap corruption. Fix: set a flag or queue an event; work in task context.
- **Pending flags not cleared**: a handler path returning without clearing the peripheral's interrupt flag → the ISR re-enters endlessly. Fix: clear the source flag on every path.
