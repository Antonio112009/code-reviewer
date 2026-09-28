---
name: NumPy arrays and NumPy 2 changes
description: NumPy pitfalls — views vs copies, silent integer overflow, NEP 50 promotion and removed aliases in NumPy 2, copy=False now raising, Windows default int64, ambiguous truthiness and the shared global RNG.
priority: 58
activation:
  content:
    - "\\bnp\\.(?:float_|complex_|NaN|Inf|PINF|NINF|infty|alltrue|sometrue|product|cumproduct|in1d|row_stack|trapz|asfarray|cast)\\b"
    - "\\bnp\\.(?:u?int(?:8|16|32)|float(?:16|32))\\b|\\.astype\\s*\\(|\\bcopy\\s*=\\s*False\\b"
    - "\\bnp\\.(?:append|random\\.\\w+)\\b|\\bdefault_rng\\s*\\("
    - "\\bnp\\.(?:array|asarray|where)\\s*\\("
  examples:
    - 'x = np.float_(3.14)'
    - 'img = img.astype(np.uint8)'
    - 'np.random.seed(42)'
    - 'arr = np.array([1, 2, 3])'
sources:
  - https://numpy.org/doc/stable/numpy_2_0_migration_guide.html
  - https://numpy.org/doc/stable/user/basics.copies.html
  - https://numpy.org/neps/nep-0050-scalar-promotion.html
  - https://numpy.org/doc/stable/reference/random/parallel.html
---
- **Views vs copies**: basic slicing (`a[1:5]`, `a[:, 0]`), `reshape` and `.T` return views → writes mutate the original; fancy/boolean indexing copies → `a[mask][0] = x` is lost. Fix: `.copy()`; assign with `a[mask] = x`.
- **Silent integer overflow**: fixed-width dtypes (`uint8` images, `int32` counters) wrap around without error in array math. Fix: widen first (`astype(np.int64)`, `sum(dtype=np.int64)`).
- **NumPy 2 promotion (NEP 50)**: Python scalars no longer upcast — `np.float32(3) + 3.0` stays float32, and out-of-range ints with small dtypes overflow or raise. Fix: explicit casts or `.item()`.
- **NumPy 2 removals**: `np.float_`, `np.NaN`, `np.Inf`, `np.alltrue` etc. raise AttributeError; `np.array(x, copy=False)` raises if a copy is needed; Windows default ints are now 64-bit. Fix: `np.float64`, `np.nan`, `np.all`, `np.asarray`.
- **Truthiness and None**: `if arr:` and `and`/`or` on arrays raise "truth value is ambiguous"; `arr == None` compares elementwise. Fix: `.any()`/`.all()`, `arr is None`.
- **Global RNG**: `np.random.seed()` state is shared across libraries and copied into forked workers → identical "random" streams. Fix: `np.random.default_rng(seed)` per worker.
