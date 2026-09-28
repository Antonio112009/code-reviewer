---
name: Logging configuration and calls
description: logging module traps — basicConfig silently ignored, dictConfig disabling existing loggers, handlers added by libraries (duplicates), %-argument mismatches that drop records, exception logging outside handlers and eager expensive arguments.
priority: 50
activation:
  content:
    - "\\b(?:basicConfig|dictConfig|fileConfig)\\s*\\("
    - "\\b(?:addHandler|setLevel|setFormatter)\\s*\\(|\\.propagate\\s*=|\\bdisable_existing_loggers\\b"
    - "\\b(?:Stream|File|RotatingFile|TimedRotatingFile|Null|Queue|Syslog)Handler\\s*\\("
    - "\\.exception\\s*\\(|\\bexc_info\\s*="
  examples:
    - 'logging.basicConfig(level=logging.INFO)'
    - 'logger.addHandler(handler)'
    - 'handler = logging.StreamHandler()'
    - 'logger.exception("failed")'
sources:
  - https://docs.python.org/3/library/logging.html#logging.basicConfig
  - https://docs.python.org/3/library/logging.config.html#dictionary-schema-details
  - https://docs.python.org/3/howto/logging.html#configuring-logging-for-a-library
  - https://docs.python.org/3/howto/logging.html#optimization
---
- **`basicConfig` is a no-op**: it does nothing when the root logger already has handlers, and any earlier `logging.info()`/`warning()` call auto-configures it → your level, format or file is silently ignored. Fix: configure first at startup, or `force=True`.
- **`disable_existing_loggers`**: `dictConfig`/`fileConfig` default to disabling every logger created before the call (module-level `getLogger(__name__)` in already-imported modules) → their logs vanish. Fix: `"disable_existing_loggers": False`.
- **Handlers in library code**: libraries that add `StreamHandler`s or call `basicConfig` duplicate every line through propagation and override the app's setup. Fix: libraries add only `NullHandler`; set `propagate=False` when attaching handlers to child loggers.
- **Argument mismatch**: `logger.info("user=%s id=%s", user)` or `%` placeholders mixed with f-strings raise inside logging → "--- Logging error ---" on stderr and the record is lost. Fix: match placeholders and arguments.
- **Traceback outside the handler**: `logger.exception()` or `exc_info=True` after the `except` block (or in a callback) logs `NoneType: None`. Fix: log inside the handler, or pass `exc_info=err`.
- **Eager expensive arguments**: `logger.debug(f"{expensive()}")` or `json.dumps(big)` as an argument runs even when DEBUG is off → hot-path cost. Fix: `%s` arguments with cheap objects, or `if logger.isEnabledFor(logging.DEBUG):`.
