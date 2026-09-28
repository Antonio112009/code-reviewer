---
name: Livewire components
description: Livewire 3/4 security and state traps — actions and public properties as untrusted input, Locked properties, authorization only in mount(), custom middleware not persisted, cached computed properties shared across users, skipped validate() and temporary uploads.
priority: 70
tags: [CWE-639, CWE-915, CWE-862]
activation:
  files: ["**/Livewire/**/*.php", "**/livewire/**/*.blade.php"]
  content:
    - '\bLivewire\\|\bextends\s+Component\b|#\[(?:Locked|Computed|Url|Validate|On)\b'
    - '\bwire:(?:model|click|submit)\b|\bWithFileUploads\b|->temporaryUrl\s*\('
  examples:
    - 'class TodoList extends Component { #[Locked] public int $listId; }'
    - '<input wire:model="title" type="text">'
sources:
  - https://livewire.laravel.com/docs/4.x/security
  - https://livewire.laravel.com/docs/4.x/computed-properties
  - https://livewire.laravel.com/docs/4.x/validation
  - https://livewire.laravel.com/docs/4.x/uploads
---
- **Actions are endpoints**: every public method can be called with any arguments (`delete($id)`) → authorize inside each action (`$this->authorize('delete', $post)`), not only on the page route or in `mount()`.
- **Public properties are input**: users can set any public property through tampered requests or `wire:model`, including ids, prices and flags → `#[Locked]` for server-owned values, store models (their ids are protected) instead of raw ids, re-check before saving.
- **Middleware persistence**: only Livewire's built-in list (auth, can, bindings…) is re-applied on update requests; custom role/tenant middleware is skipped unless registered with `Livewire::addPersistentMiddleware()`.
- **Shared computed cache**: `#[Computed(cache: true)]` caches one value for all users and components → per-user data leaks; `persist: true` keeps values for an hour, so revoked access still sees them.
- **Validate before saving**: `#[Validate]` only checks properties as they update; skipping `$this->validate()` in the action saves untouched or tampered fields unvalidated.
- **Temporary uploads**: `WithFileUploads` stores files in a temporary directory before validation → call `$this->validate()` with file rules before `store()`, never trust `getClientOriginalName()`.
- **#[Url] properties**: values bound from the query string are attacker-controlled on first load → validate and authorize them like request input.
