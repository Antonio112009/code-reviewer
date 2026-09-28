---
name: Activities and fragments
description: Activity/Fragment lifecycle defects — view binding and observers outliving the fragment view, fragment constructor arguments, transactions after state is saved, late Activity Result registration, context leaks, callbacks after detach and oversized saved state.
priority: 64
tags: [CWE-401, CWE-672]
activation:
  content:
    - '\b(?:_binding|binding)\s*='
    - '\.observe\s*\(\s*this\b'
    - '\bonDestroyView\b|\bonSaveInstanceState\b'
    - '\.commit(?:AllowingStateLoss|Now)?\s*\(\s*\)'
    - '\bregisterForActivityResult\s*\('
    - '\b(?:requireContext|requireActivity|requireView)\s*\(\s*\)'
    - '\b(?:postDelayed|registerListener|requestLocationUpdates|addCallback)\s*\('
    - '\bclass\s+\w+\s*\([^)\n]{1,120}\)\s*:\s*(?:\w+)?Fragment\s*\('
  examples:
    - '_binding = FragmentDetailBinding.inflate(inflater, container, false)'
    - 'viewModel.user.observe(this) { updateUi(it) }'
    - 'override fun onDestroyView() { _binding = null }'
    - 'supportFragmentManager.beginTransaction().add(fragment, "tag").commit()'
    - 'val launcher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { }'
    - 'val ctx = requireContext()'
    - 'handler.postDelayed({ refresh() }, 1000)'
    - 'class DetailFragment(val id: Long) : Fragment() {'
sources:
  - https://developer.android.com/guide/fragments/lifecycle
  - https://developer.android.com/topic/libraries/view-binding#fragments
  - https://developer.android.com/training/basics/intents/result
  - https://developer.android.com/guide/components/activities/parcelables-and-bundles
---
- **Views outlive onDestroyView**: a fragment keeping `binding`/view fields after `onDestroyView`, or observing LiveData with `observe(this, …)` → leaked view hierarchy, duplicate observers after returning from the back stack. Fix: null `_binding` in `onDestroyView`; observe with `viewLifecycleOwner`.
- **Fragment constructor arguments**: `class DetailFragment(val id: Long) : Fragment()` → the system recreates fragments with the no-arg constructor after rotation or process death → `InstantiationException` or lost arguments. Fix: `arguments` Bundle or a `FragmentFactory`.
- **Transactions after save**: `commit()`/`DialogFragment.show()` after `onSaveInstanceState` (async callbacks, `onActivityResult`) → `IllegalStateException`; `commitAllowingStateLoss()` silently drops the change on restore. Fix: navigate only while STARTED.
- **Late result registration**: `registerForActivityResult` called in a click handler or after `onCreate` → `IllegalStateException` (must register before STARTED). Fix: register as a property.
- **Context leaks**: Activity/View/Fragment kept in singletons, companion objects or long-lived listeners (`postDelayed` runnables, sensors, location, receivers) not removed in `onStop`/`onDestroy` → whole Activity leaked. Fix: `applicationContext`, symmetric unregister.
- **Callbacks after detach**: network or timer callbacks calling `requireContext()`/`requireActivity()` after the fragment detached → `IllegalStateException`. Fix: lifecycle-scoped coroutines.
- **Oversized saved state**: lists, bitmaps or large Parcelables in `onSaveInstanceState`, fragment arguments or intent extras → `TransactionTooLargeException` (1 MB binder buffer) when the app goes to background. Fix: save IDs, persist data.
