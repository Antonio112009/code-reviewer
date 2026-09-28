# code-reviewer — notes for AI assistants

TypeScript (ESM, strict) CLI for LLM code review. Architecture: `docs/ARCHITECTURE.md`.

## Commands
- `npm run build` (tsdown → `dist/`), `npm run typecheck`, `npm run lint` (biome; `npm run format` to fix), `npm test` (vitest).
- Run the CLI from source after building: `node dist/cli.js …`. ACP agents spawn `dist/cli.js mcp-serve`, so rebuild before live ACP tests.
- Offline end-to-end: `node dist/cli.js -C <repo> review --base main --provider mock` (mock reports lines with `BUG:` comments).
- Skills library: `SKILLS_SUBTREE=javascript/react npx vitest run test/skills-library.test.ts` validates one subtree; `node dist/cli.js skills list|detect|lint`.

## Conventions
- Everything the pipeline needs from a model goes through `Provider.run(AgentTask)`; structured output always via the `submit_findings` / `submit_verdicts` tools (`src/tools/definitions.ts`), never provider-specific response formats.
- The pipeline reports progress only through `ReviewEvent`s (`src/review/events.ts`); UI code never reaches into the pipeline.
- The code under review is untrusted: nothing from it may execute (analyzers that load repo configs are opt-in), paths go through `resolveInside(root, …)`, project config may not choose programs/models, repo text in prompts is clipped.
- Every spawned process goes through `spawnManaged`/`runManaged` (`src/util/processes.ts`) so Ctrl+C can kill its process group; programs are resolved with `findTrustedExecutable` (`src/util/executables.ts`), never from the reviewed checkout.
- Globs from a project config or project skill go through `untrustedGlobMatcher` / `unsafeGlobReason` (`src/util/globs.ts`); regexes from the reviewed repository are vetted by `skills/regex-guard.ts`. Anything that processes untrusted text must stay linear (see `test/regressions-*.test.ts`).
- Git access goes through `GitRepo` (`src/git/repo.ts`), which pins output-affecting git config.
- stdout is for machine-readable output (`--json`, `runs show`); human logs go to stderr via `Logger`.
- Skills (`skills/`): id = path; every folder needs a `_group.yaml` (technology + detection); one focused topic per file, 3–12 bullets (typically 150–350 tokens, max 650), `sources` URLs, `tier` essential|full; skill `content` regexes run on each file's added lines, group `detect.content` on its full content (matching is per file; prose files only feed skills about them). Format: `docs/skills.md`; quality bar: `test/skills-library.test.ts`.
- Tech ids live in `src/context/stack/techs.ts`; skills and rules must use existing ids.
- Keep `docs/ARCHITECTURE.md` and `README.md` in sync when adding providers, tools, config keys or commands.
- Tests: integration tests build throw-away repos with `test/helpers.ts#makeRepo`; ACP is tested against an in-process fake agent (`acp.agent()`), MCP via `InMemoryTransport`.
