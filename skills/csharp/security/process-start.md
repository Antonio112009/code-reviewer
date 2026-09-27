---
name: Process execution
description: Process.Start injection and reliability — shell command strings and concatenated Arguments, UseShellExecute with user paths/URLs, option injection into CLI tools, PATH lookups, and deadlocks/zombies from redirected output.
priority: 74
tags: [CWE-78, CWE-88, CWE-426, A05:2025]
activation:
  content:
    - '\bProcess\.Start\(|\bProcessStartInfo\b'
    - '\b(?:UseShellExecute|ArgumentList|RedirectStandard(?:Output|Error|Input)|WaitForExit(?:Async)?)\b'
    - '"(?:cmd(?:\.exe)?|/bin/(?:ba)?sh|bash|sh|powershell(?:\.exe)?|pwsh)"'
sources:
  - https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo.argumentlist
  - https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo.useshellexecute
  - https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.standardoutput
---
- **Shell strings**: `Process.Start("cmd.exe", "/c " + input)`, `"/bin/sh", $"-c \"{input}\""` or `ProcessStartInfo.Arguments` built by concatenation → command/argument injection via quotes, `&`, `;`, `|`, `$()`. Fix: call the executable directly and pass values through `ArgumentList` (.NET Core 2.1+).
- **UseShellExecute**: `UseShellExecute = true` (the .NET Framework default; `false` on .NET Core) with a user-controlled `FileName` or URL → the OS opens it with its associated handler (executables, `file://`, UNC paths). Fix: allowlist schemes/paths, `UseShellExecute = false`.
- **Option injection**: user values beginning with `-`/`--` passed as positional arguments to git, curl, tar, ffmpeg etc. → flags such as `--upload-pack`, `-o`, `--output` executed. Fix: insert `--` before positional args, reject leading dashes.
- **Executable lookup**: `FileName = "tool"` without a full path resolves via `PATH` (and the working directory on Windows) → a planted binary runs. Fix: absolute paths to trusted locations.
- **Redirect deadlocks**: redirecting both stdout and stderr, then `ReadToEnd()` one before the other and `WaitForExit()` → deadlock when the unread pipe fills; no timeout/`Kill(entireProcessTree: true)` → hung or orphaned processes. Fix: read both asynchronously, `WaitForExitAsync(ct)` (.NET 5+).
