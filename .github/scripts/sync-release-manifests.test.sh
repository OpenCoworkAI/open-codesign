#!/usr/bin/env bash
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/sync-release-manifests.sh"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/bin"
cat > "$fixture/bin/gh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$GH_TEST_LOG"
case "$1 $2" in
  'pr list') [ ! -f "$GH_TEST_CREATED" ] || echo 123 ;;
  'pr create')
    [ "${GH_TEST_DENY_CREATE:-0}" != 1 ] || exit 1
    touch "$GH_TEST_CREATED"
    ;;
  'pr merge') [ "$3" = 123 ] ;;
  *) exit 1 ;;
esac
MOCK
chmod +x "$fixture/bin/gh"
export PATH="$fixture/bin:$PATH"
export GH_TOKEN=test-token RELEASE_TAG=v1.2.3
export GH_TEST_LOG="$fixture/gh.log" GH_TEST_CREATED="$fixture/created"
git init --bare -q "$fixture/remote.git"
git init -q -b main "$fixture/work"
cd "$fixture/work"
git config user.name Test
git config user.email test@example.invalid
mkdir packaging
echo old > packaging/manifest
git add .
git commit -qm initial
git remote add origin "$fixture/remote.git"
git push -q origin main
original_main="$(git rev-parse HEAD)"

# A no-op neither creates a PR nor pushes a branch.
bash "$script"
test ! -e "$GH_TEST_LOG"

# Missing credentials fail before touching the remote.
echo new > packaging/manifest
if GH_TOKEN= bash "$script"; then exit 1; fi
test -z "$(git ls-remote --heads origin refs/heads/release/v1.2.3-manifests)"

# A real commit and remote branch, but only mocked GitHub API calls.
bash "$script"
test "$(git ls-remote --heads origin refs/heads/main | cut -f1)" = "$original_main"
git log -1 --format=%B | (! grep -F '[skip ci]')
grep -F 'pr create --base main --head release/v1.2.3-manifests' "$GH_TEST_LOG"
grep -F 'pr merge 123 --auto --squash' "$GH_TEST_LOG"

# Rerunning from main updates the generated branch and reuses its open PR.
git reset --hard -q "$original_main"
echo newer > packaging/manifest
bash "$script"
test "$(grep -c '^pr create ' "$GH_TEST_LOG")" = 1
test "$(git ls-remote --heads origin refs/heads/release/v1.2.3-manifests | cut -f1)" = "$(git rev-parse HEAD)"

# A forbidden PR creation must fail, rather than reporting a green sync job.
git reset --hard -q "$original_main"
echo denied > packaging/manifest
rm "$GH_TEST_CREATED"
if GH_TEST_DENY_CREATE=1 bash "$script"; then exit 1; fi
test "$(git ls-remote --heads origin refs/heads/main | cut -f1)" = "$original_main"
echo 'Manifest sync integration checks passed'
