# AGENTS.md - Open CoDesign

Instructions for Codex and other AI coding agents working in this repository. Read this before making changes.

`CLAUDE.md` may lag behind the current plan. For Codex work, treat this file as the public source of truth. If local internal docs such as `docs/VISION.md`, `docs/PRINCIPLES.md`, or `docs/v0.2-plan.md` exist, use them as additional context; if they are missing, do not block public-contributor work on them.

## What This Project Is

Open CoDesign is an open-source desktop design agent. It turns prompts, local files, skills, scaffolds, brand systems, and model output into design artifacts on the user's laptop.

The v0.2 direction is no longer a single-prompt generator. Each design is a long-running pi session with a real workspace. The agent can read and edit files, run permissioned commands, ask structured questions, preview artifacts, expose tweak controls, generate images when the configured model supports it, and produce `DESIGN.md` design-system artifacts.

The original inspiration was Claude Design. The product boundary is now clearer: Open CoDesign borrows proven coding-agent mechanics, then adds design-specific tools and a local-first workspace model.

`docs/` is gitignored. Maintainers may have internal plans, handoffs, and research locally; public contributors may not. Do not cite `docs/**` in public PR review comments unless the file exists in the public checkout.

## Hard Constraints

These are project commitments, not preferences:

1. No bundled model runtimes. Do not ship Ollama, llama.cpp, Python, browser binaries, or model weights inside the installer. Use system installs or lazy-download with user-visible consent.
2. BYOK only. No hosted account, proxied API, or telemetry by default. User credentials stay in human-readable local config.
3. Local-first storage. v0.2 uses pi JSONL sessions plus real workspace files. Existing v0.1 SQLite data may be migrated, but do not add new SQLite tables for sessions, chat history, comments, snapshots, or design files.
4. Every design has a workspace. No sealed/open split in v0.2. The workspace filesystem is the source of truth for artifacts and assets.
5. Shipped app/runtime dependencies, bundled assets, scaffolds, skills, brand refs, and copied code must be MIT-compatible permissive. Reject GPL, AGPL, SSPL, proprietary deps, and unclear copied assets in anything that is bundled, linked, imported by app code, or distributed to users. Workflow-only CI/release tools may use copyleft licenses when they are not vendored, bundled, linked, or copied into the product; document the reason and keep their outputs limited to ordinary metadata or manifests.
6. Lazy-load heavy features. PPTX export, web capture, scaffolds, skills, brand refs, and image generation must load on demand rather than at app start.
7. Reuse pi primitives first. `pi-coding-agent` owns sessions, built-in tools, bash execution, event streaming, model registry, provider registration, and capability data unless a design-specific need proves otherwise.
8. Brand values are data, not model memory. Use `DESIGN.md`, user files, official CSS/SVG/screenshots, or brand URLs. Do not invent brand hex values from memory.
9. PRs should stay compatible, upgradeable, lean, and elegant. If `docs/PRINCIPLES.md` is present, use its Principles 5b wording as the detailed checklist.

## AI Visibility For Web Work

When building or updating any website, project homepage, product page, personal site, documentation site, blog, or public project page, include AI visibility in the default delivery scope unless the user explicitly opts out.

- Add `/llms.txt` with a concise Markdown overview of the site, author or organization, key pages, canonical project or product descriptions, and links to machine-readable resources.
- Add `/llms-full.txt` when the site has enough substantive public content to justify a fuller AI-readable context file.
- Configure `robots.txt` deliberately: allow search and retrieval crawlers that help AI systems cite or retrieve public content, and treat training crawlers as a separate policy decision.
- Maintain `sitemap.xml` and make sure it covers important public pages. Mention Google Search Console and Bing Webmaster Tools submission when relevant.
- Add appropriate JSON-LD structured data where useful, such as `Person`, `Organization`, `WebSite`, `BlogPosting`, `SoftwareApplication`, `FAQPage`, or `CreativeWork`.
- Prefer clean Markdown or JSON machine-readable endpoints for important entities such as profiles, projects, posts, docs, releases, FAQs, and product facts.
- Keep the content truthful, source-backed, and non-spammy. The goal is to help AI systems understand and cite existing real content accurately, not to generate low-quality SEO filler.

## Current Architecture Direction

### Agent Runtime

- Use `pi-coding-agent` and `pi-ai`.
- Use pi built-ins for `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls`.
- Gate tools through the pi `tool_call` hook and the Open CoDesign permission UI.
- Read capabilities from pi `Model<T>` fields such as `input`, `reasoning`, `cost`, `contextWindow`, and `maxTokens`.
- Register custom providers through `pi.registerProvider()`. Do not build a parallel provider SDK layer.
- All LLM calls go through `pi-ai`; do not import provider SDKs directly in app code.

### Storage

- Design equals pi session.
- Session history lives under app user data as pi JSONL.
- Design files, generated HTML/JSX/CSS, assets, exports, `AGENTS.md`, and `DESIGN.md` live in the user workspace.
- Workspace settings live in `.codesign/settings.json` with `schemaVersion`.
- `settings.local.json` is personal and should stay gitignored.
- v0.1 SQLite is legacy data to migrate, not the v0.2 storage model.

### Tools

The v0.2 tool surface is pi's seven built-ins plus Open CoDesign design tools:

- `ask(questions)` renders structured questions and waits for the user.
- `scaffold(kind, path)` copies a curated starter into the workspace.
- `skill(name)` lazy-loads skill text from a manifest.
- `preview(path)` renders artifacts and returns console errors, asset errors, DOM outline, metrics, and screenshots for vision models.
- `gen_image(prompt, path)` writes generated images to disk when capability and provider config allow it.
- `tweaks(blocks)` declares editable controls across files.
- `todos(items)` shows task state for complex turns.
- `done(path)` ends a turn after preview self-check.

Do not reintroduce a verifier subagent, snip tool, custom bash tool, custom list-files tool, or agent-written working memory for v0.2 unless the plan changes.

### Design System

- `DESIGN.md` follows the Google spec and can be both input and output.
- Agent-generated multi-screen work should keep visual consistency by updating `DESIGN.md` as tokens emerge.
- Built-in brand refs must include attribution, source, license metadata, and a "not affiliated" note.
- Built-in skills use the agentskills-style `SKILL.md` format.
- Skill and scaffold manifests should carry license and source metadata.

## Stack and Conventions

- Package manager: `pnpm` only. Never use `npm` or `yarn`.
- Build orchestration: Turborepo.
- Lint and format: Biome.
- Tests: Vitest for unit tests, Playwright for E2E.
- TypeScript: strict mode, `verbatimModuleSyntax`, bundler resolution, no `any`.
- Commits: Conventional Commits.
- Versioning: Changesets. Do not hand-edit `CHANGELOG.md`.
- Node: 22 LTS, pinned by `.nvmrc` and `engines`.
- Exact package versions live in `package.json`, workspace manifests, and `pnpm-lock.yaml`. Read those files instead of trusting stale docs.

### Frontend

- React + Vite + Tailwind v4 + CSS variables.
- State uses Zustand. Do not introduce Redux, Recoil, or MobX.
- Components use Radix primitives and custom shadcn-style wrappers in `packages/ui`.
- Icons use `lucide-react`.
- Forms use native `<form>` and `FormData`.
- Animations use Tailwind transitions. Do not introduce framer-motion or motion.
- App chrome must use `packages/ui` tokens. Artifact output may define its own visual system.
- Sandbox preview remains Electron iframe `srcdoc` plus runtime tooling.

## Repository Layout

```
apps/
  desktop/           # Electron app shell, main process, renderer
packages/
  core/              # Agent orchestration, prompts, design tools
  providers/         # pi integration and provider compatibility shims
  runtime/           # Sandbox renderer and preview runtime
  ui/                # Shared app UI tokens and components
  artifacts/         # Artifact schemas and bundle formats
  exporters/         # PDF / PPTX / ZIP exporters, lazy-loaded
  templates/         # Built-in examples and starter templates
  shared/            # Shared types, utils, schemas
docs/                # Internal vision, plans, principles, research; gitignored
examples/            # Public demo reproductions
```

## Doing Tasks Here

- For non-trivial architecture or product work, read `docs/VISION.md`, `docs/PRINCIPLES.md`, and `docs/v0.2-plan.md` when they exist locally. Public checkouts may not have `docs/`; in that case rely on this file, public issues/PRs, and README context.
- Use planning files in `.Codex/workspace/` for tasks spanning more than five tool calls or more than three files when a durable local plan would help. Do not create planning churn for small, direct fixes.
- Use git worktrees for parallel or unrelated feature work. Do not mix two unrelated branches in one checkout.
- Check `docs/RESEARCH_QUEUE.md` before touching sandbox, inline comments, tweaks, PPTX, pi capabilities, scaffolds, skills, or brand refs when that file exists locally.
- Keep edits scoped. Avoid drive-by refactors.
- Before adding a shipped/runtime dependency, check license, install size, alternatives, and whether it can be a peer dep. For workflow-only tools, document why they are not bundled and whether their outputs affect distributed artifacts.
- Add or update Vitest coverage for feature work. Broaden tests when changing migrations, permissions, tool hooks, or shared contracts.
- Prefer manifest and switch logic over registries until two real callers need more.
- Comment only when the reason would surprise the next maintainer.

## Permission Model

Open CoDesign uses one permission model with tiers:

- Tier 0: workspace-local reads/writes, simple file commands, and read-only git may run without interruption.
- Tier 1: installs, build commands, non-local network fetches, and cwd-external commands ask once and can be allowlisted.
- Tier 2: publishing, pushing, sudo, and high-blast-radius commands ask every time.
- Tier 3: destructive system commands, `curl | sh`, and system-directory writes are blocked without override.

Do not hide blocked tool calls. Show the command, path, tier, and reason.

## Things to Avoid

- Adding `node_modules`, build outputs, `.env*`, generated release artifacts, or private local files to git.
- Importing `@anthropic-ai/sdk`, `openai`, `@google/genai`, or other provider SDKs in app code.
- Writing tests that mock the LLM at the SDK level. Mock at the core or pi boundary.
- Adding tracking, analytics, account flows, cloud sync, or auto-update without explicit opt-in UX.
- Hard-coding user paths. Respect XDG, Electron `app.getPath()`, and workspace roots.
- Adding new SQLite-backed feature state for v0.2 session/design data.
- Introducing `project` as a product abstraction in v0.2. Multiple sessions can share a workspace, but the sidebar lists sessions.
- Exposing session branching UI, undo/version rollback, MCP support, or community skill installation in v0.2 unless the plan changes.
- Using `console.*` in `apps/desktop/src/main/**`, `packages/core/**`, `packages/providers/**`, `packages/exporters/**`, or `packages/shared/**`. Use the project logger.

## Useful Commands

```bash
pnpm i
pnpm dev
pnpm test
pnpm test:e2e
pnpm lint
pnpm typecheck
pnpm build
pnpm changeset
```
