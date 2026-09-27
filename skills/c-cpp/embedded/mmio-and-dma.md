---
name: Registers, barriers and DMA
description: Memory-mapped I/O and DMA defects — registers accessed without volatile, volatile mistaken for ordering, read-modify-write on write-1-to-clear or shared registers, D-cache maintenance and DMA buffer lifetime.
priority: 65
tags: [CWE-1265, CWE-662]
activation:
  content:
    - '\bvolatile\b|\b__IO\b|\b__[IO]M?\s+uint(?:8|16|32)_t'
    - '->\s*[A-Z][A-Z0-9_]*\s*[|&^]?=[^=]'
    - '\b(?:SCB_(?:Clean|Invalidate|CleanInvalidate)DCache\w*|__DSB|__DMB|__ISB|HAL_\w*DMA\w*|dma_\w+)\s*\('
sources:
  - https://gcc.gnu.org/onlinedocs/gcc/Volatiles.html
  - https://dannas.name/2023/04/27/write-one-to-clear
  - https://arm-software.github.io/CMSIS_6/latest/Core/group__Dcache__functions__m7.html
  - https://en.cppreference.com/w/c/language/volatile
---
- **Missing volatile**: peripheral registers or hardware-written memory accessed through non-`volatile` pointers → polling loops hoisted, reads cached, writes merged or dropped. Fix: `volatile` (`__IO`) register definitions.
- **volatile is not a barrier**: ordinary buffer writes may move after the volatile register write that starts a DMA or peripheral, and the CPU may reorder too → the device reads stale data. Fix: `__DMB()`/`__DSB()` before starting it.
- **Write-1-to-clear flags**: `SR |= FLAG`, `SR &= ~FLAG` or bit-field writes on status registers write back every pending flag they read → unhandled interrupts get cleared. Fix: write only the bit (`SR = FLAG`).
- **Shared register read-modify-write**: `PORT |= pin` in main code while an ISR updates the same register → lost updates. Fix: set/reset registers (e.g. BSRR), bit-banding or a critical section.
- **DMA and data cache**: on cached cores (Cortex-M7, Cortex-A), clean buffers before DMA reads them, invalidate after DMA writes; other data in the same cache line (32 bytes on M7) is lost. Fix: line-aligned, padded buffers or non-cacheable regions.
- **DMA buffer lifetime**: DMA targets on the stack, freed or reused mid-transfer, or in RAM the DMA master cannot reach → corruption or silent no-ops. Fix: owned buffers until completion; check the bus matrix.
