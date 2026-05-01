# Contributing to Open CoDesign

Thanks for considering a contribution. This project is in **pre-alpha**: the architecture is being shaped, the codebase is small, and we are deliberately keeping the surface area lean. The fastest way to help is to file thoughtful issues; the second fastest is to start a discussion before writing code.

## Before you start

- Read [`AGENTS.md`](./AGENTS.md) or [`CLAUDE.md`](./CLAUDE.md) — repository conventions and hard constraints
- If maintainer-local docs are available, skim `docs/VISION.md` and `docs/PRINCIPLES.md` for product direction
- Search existing [issues](https://github.com/OpenCoworkAI/open-codesign/issues) and [discussions](https://github.com/OpenCoworkAI/open-codesign/discussions) before opening a new one

## Filing an issue

Use our issue templates:

- **[Bug report](https://github.com/OpenCoworkAI/open-codesign/issues/new?template=bug_report.yml)** — reproduction steps, OS/version, and a diagnostics bundle (Settings → Storage → Export diagnostics) speed up triage significantly.
- **[Feature request](https://github.com/OpenCoworkAI/open-codesign/issues/new?template=feature_request.yml)** — explain the *user problem* before proposing a solution, and confirm the proposal does not conflict with the [hard constraints](./AGENTS.md).

## Submitting a PR

1. **Open an issue or discussion first** for anything bigger than a typo. We may have already considered the change, or have a better path in mind.
2. **Fork, branch, code.** Branch name: `<type>/<short-slug>` (e.g. `feat/url-style-steal`, `fix/cjk-pptx-wrap`).
3. **Conventional Commits** subject required. Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, `ci`, `build`.
4. **Run locally**: `pnpm lint && pnpm typecheck && pnpm test`. If lint only reports Biome formatting or safe autofix issues, run `pnpm lint:fix`, commit the result, then rerun the checks.
5. **Add a changeset** if your change is user-visible: `pnpm changeset`.
6. **One concern per PR.** Refactors, fixes, and features in separate PRs.
7. **Keep PRs small.** Anything over ~400 LOC of substantive change should be split or pre-discussed.

## Dependency policy

Adding a production dependency requires PR description to include:
- **Install size impact** (run `pnpm why <pkg>` and report the unpacked size)
- **License** (must be MIT-compatible permissive software: MIT, BSD, ISC, or similar; never GPL/AGPL/SSPL)
- **Why this and not alternatives**
- **Could it be a peer dep instead?**

The bar is intentionally high. We're at < 30 prod deps and want to stay there.

## Code style

Biome handles formatting and most lint rules. `pnpm lint:fix` applies fixes. Don't hand-format.

## Licensing of contributions

By submitting a PR, you agree that your contributions are licensed under MIT.

## Where to ask questions

- Architecture / direction: GitHub Discussions
- Bugs / feature requests: GitHub Issues
- Real-time chat: (Discord link to be added)
