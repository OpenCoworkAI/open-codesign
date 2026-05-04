# CLAUDE.md — Open CoDesign

Instructions for Claude Code (and any AI coding agent) working in this repository. Read this before making changes.

## What this project is

open-codesign is an Electron desktop app that turns natural-language prompts into design artifacts (HTML prototypes, PDFs, PPTX decks, marketing assets). It's the open-source counterpart to Anthropic's Claude Design, with multi-provider model support via `pi-ai` and a local-first storage model.

The full vision and locked decisions live in `docs/VISION.md` when the internal docs are present locally. Public checkouts may not have `docs/`; in that case use `AGENTS.md`, public issues/PRs, and README context instead of blocking.

> Note: `docs/` is gitignored — internal team materials (research, roadmaps, handoffs) live there but are not part of the public repo. Clone contributors will not have this directory; team members will find it present locally after cloning and copying the internal docs back.

## Hard constraints (do not violate)

These are project-level commitments, not preferences:

1. **No bundled model runtimes.** No Ollama, llama.cpp, Python, or browser binaries shipped in the installer. Use system installs or lazy-download on demand.
2. **BYOK only.** No proxied API calls, no cloud account, no telemetry by default. User credentials stay in `~/.config/open-codesign/config.toml` (plaintext, file mode 0600 — matching Claude Code / Codex / gh CLI conventions).
3. **Local-first storage.** v0.2 design state is file/session based and local-first. Do not add new SQLite-backed session/design feature state.
4. **Permissive shipped dependencies.** Shipped app/runtime dependencies, bundled assets, scaffolds, skills, brand refs, and copied code must be MIT-compatible permissive. Workflow-only CI/release tools may use copyleft licenses when they are not vendored, bundled, linked, or copied into the product; document the reason.
5. **Lazy-load heavy features.** PPTX export, web capture, codebase scan, etc. must dynamic-import on first use, not on app start.
6. **Compatibility, upgradeability, no bloat, elegance** — the four PRINCIPLES §5b checks. Every PR description must mark all four green.

## Stack & conventions

- **Package manager**: `pnpm` only. Never use `npm` or `yarn`. Workspace declared in `pnpm-workspace.yaml`.
- **Build orchestration**: Turborepo.
- **Lint + format**: Biome (single tool, no ESLint + Prettier).
- **Tests**: Vitest (unit) + Playwright (E2E). New features require at least one Vitest test.
- **TypeScript**: `strict: true`, `verbatimModuleSyntax: true`, `moduleResolution: "bundler"`. No `any`.
- **Commits**: Conventional Commits, enforced by commitlint.
- **Versioning**: Changesets. Don't hand-edit `CHANGELOG.md`.
- **Node**: 22 LTS (pinned via `.nvmrc` + `engines`).
- **Model layer**: All LLM calls go through `@mariozechner/pi-ai`. Don't import provider SDKs directly in app code; if pi-ai lacks a feature, add it to `packages/providers` as a thin extension.

### Frontend stack (locked)

- **UI framework**: React 19 + Vite 6
- **Styles**: Tailwind v4 + CSS variables (tokens in `packages/ui`)
- **State**: Zustand (do not introduce Redux / Recoil / MobX)
- **Routing**: native `useState` view switching at first; TanStack Router only when route count > 5
- **Components**: Radix UI primitives + custom shadcn-style wrappers in `packages/ui`
- **Icons**: `lucide-react` (only)
- **Forms**: native `<form>` + `FormData` (do not introduce react-hook-form / formik)
- **Animations**: Tailwind transitions (do not introduce framer-motion / motion)
- **Sandbox renderer**: Electron iframe `srcdoc` + esbuild-wasm + import maps (see `docs/research/03-sandbox-runtime.md`)
- **Electron version**: latest stable, but NOT 41.x (cross-origin isolation regression)
- **Storage**: file/session-backed design state; TOML files for config (no electron-store blob)

## Repository layout

```
apps/
  desktop/           # Electron app shell (main + renderer)
packages/
  core/              # Generation orchestration (prompt → artifact pipeline)
  providers/         # pi-ai adapter + custom provider extensions
  runtime/           # Sandbox renderer (iframe-based preview)
  ui/                # Shared design system (aligned with open-cowork tokens)
  artifacts/         # Artifact schema (HTML / React / SVG / PPTX)
  exporters/         # PDF / PPTX / ZIP exporters (lazy-loaded)
  templates/         # Built-in demo prompts and starter templates
  shared/            # Types, utils, zod schemas
docs/                # Vision, roadmap, principles, RFCs (gitignored — internal only)
examples/            # Reproductions of Claude Design public demos
```

## Doing tasks here

- **Read `docs/VISION.md` and `docs/PRINCIPLES.md` when available** for any non-trivial change. Public contributors may not have internal docs.
- **Use the planning-with-files workflow** for any task spanning > 5 tool calls or > 3 files. Plans live in `.claude/workspace/`.
- **Use git worktrees for parallel work.** See `docs/COLLABORATION.md` for the workflow. Never run two unrelated feature branches in the same checkout.
- **Check `docs/RESEARCH_QUEUE.md` when available** before starting work that touches sandbox / inline-comment / slider / PPTX / pi-ai capabilities — research may still be pending and decisions unresolved.
- **Respect the lean budget.** Before adding a dependency: search for a tiny alternative, consider inlining, ask if it can be a peer dep.
- **UI must use `packages/ui` tokens.** Don't hard-code colors, fonts, or spacing in app code. If a token is missing, add it to `packages/ui` first.
- **No "design for the future" abstractions.** Three similar lines is fine. Don't introduce factories, plugin systems, or config-driven dispatch unless we have two real callers.
- **No comments explaining what code does.** Names should do that. Only comment the *why* when it's surprising.
- **Schema-version everything that lives on disk.** Config files, SQLite tables, IPC payloads, exported bundle formats — all carry a `schemaVersion` field so we can migrate without breaking older installs.

## Things to avoid

- ❌ Adding `node_modules`, build outputs, or `.env*` files to git
- ❌ Importing from a provider SDK (`@anthropic-ai/sdk`, `openai`, `@google/genai`) in app code
- ❌ Writing tests that mock the LLM at the SDK level — mock at the `core` boundary instead
- ❌ Adding tracking, analytics, or auto-update without explicit opt-in UX
- ❌ Hard-coding any path; respect XDG base dirs / Electron `app.getPath()`
- ❌ Synchronous I/O in the main process
- ❌ `console.*` in `apps/desktop/src/main/**`, `packages/core/**`, `packages/providers/**`, `packages/exporters/**`, `packages/shared/**` — use `getLogger()` (main) or the injected `CoreLogger` (core/providers/exporters). Biome enforces this.

## Useful commands

```bash
pnpm i                  # install (uses Corepack-pinned pnpm)
pnpm dev                # start Electron + Vite renderer
pnpm test               # vitest watch
pnpm test:e2e           # playwright
pnpm lint               # biome check
pnpm typecheck          # tsc --noEmit across workspace
pnpm build              # produce signed Mac/Win installers
pnpm changeset          # record a release-worthy change
```

## Open questions / pending research

See `docs/RESEARCH_QUEUE.md`. Don't prematurely lock in answers to questions still under investigation.
