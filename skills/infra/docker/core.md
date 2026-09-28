---
name: Docker
description: Container build and runtime defects in Dockerfiles, entrypoints and Compose files, such as lost stop signals, exec-form traps, root or host access, build drift, ARG scope, platform mismatches, context leaks, dead healthchecks and exposed ports.
category: infra
priority: 58
tier: essential
tags:
  - CWE-250
  - CWE-538
  - CWE-668
  - OWASP-A02
activation:
  stack:
    - infra.docker
  languages:
    - dockerfile
    - yaml
    - shell
    - text
  files:
    - "**/Dockerfile*"
    - "**/*.{Dockerfile,dockerfile}"
    - "**/Containerfile*"
    - "**/.dockerignore"
    - "**/{docker-compose,compose}.{yml,yaml}"
    - "**/{docker-compose,compose}.*.{yml,yaml}"
    - "**/*entrypoint*.sh"
  content:
    - ^FROM[ \t]+(?:--platform=\S+[ \t]+)?(?:[\w.${}-]+[/:@][\w.${}/:@-]*|\$\{?\w+\}?)(?:[ \t]+[Aa][Ss][ \t]+[\w.-]+)?[ \t]*$
    - "^[ \\t]*(?:depends_on|env_file|network_mode|cap_add|security_opt):"
  examples:
    - 'FROM golang:1.22-alpine AS builder'
    - '    depends_on:'
---
- **Lost stop signal**: shell-form `CMD` chains or entrypoints without `exec "$@"` leave sh as PID 1; PID 1 ignores unhandled SIGTERM (Node, Python) → SIGKILL, no drain. Fix: exec form, `--init`.
- **Exec-form traps**: exec form never expands `$VAR`; single-quoted JSON falls back to shell form; shell form fails without `/bin/sh` (`scratch`, distroless); shell-form `ENTRYPOINT` drops `CMD` → broken starts.
- **Root and host access**: final stage without a numeric `USER` (named users fail Kubernetes `runAsNonRoot`); `privileged`, `docker.sock` mounts, `cap_add: SYS_ADMIN`, host network → host compromise.
- **Build drift**: `FROM` on `latest` or major-only tags, `apt-get update` in its own cached `RUN`, `RUN` pipes without `pipefail` (failed `curl | tar` passes) → unreproducible or broken images. Fix: digests, `SHELL` with `-o pipefail`.
- **ARG scope**: `ARG` before `FROM` or from another stage is empty inside a stage → silently wrong versions or paths. Fix: redeclare it.
- **Platform mismatch**: glibc binaries or native modules on Alpine (musl), `CGO_ENABLED=1` binaries in `scratch`, `--platform=$BUILDPLATFORM` on the final stage → "not found" or exec format errors.
- **Context leaks**: `COPY . .` without a context-root `.dockerignore` ships `.git` and host `node_modules`/`.venv` → leaked history; host-built native modules overwrite the image install.
- **Dead healthchecks**: `HEALTHCHECK` or compose `test` using `curl`/`wget` absent from slim images, or probing dependencies → always unhealthy; `service_healthy` dependents never start.
- **Published ports**: compose `ports: "5432:5432"` binds all interfaces and Docker's NAT rules bypass ufw → public database. Fix: `127.0.0.1:5432:5432`.
- **Compose state**: `depends_on` without `condition: service_healthy` races startup; `$` in values is interpolated (write `$$`); named volumes copy image files only once → boot errors, mangled passwords, stale files.
