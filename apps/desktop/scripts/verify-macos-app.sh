#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 <Open CoDesign.app|release-dir> <arm64|x64>" >&2
}

if [ "$#" -ne 2 ]; then
  usage
  exit 2
fi

target_path="$1"
expected_arch="$2"
print_binary="${CODESIGN_VERIFY_PRINT_BINARY:-0}"

case "$expected_arch" in
  arm64)
    expected_macho="arm64"
    ;;
  x64)
    expected_macho="x86_64"
    ;;
  *)
    usage
    exit 2
    ;;
esac

log() {
  printf '%s\n' "$*" >&2
}

fail() {
  printf '::error::%s\n' "$*" >&2
  exit 1
}

has_arch() {
  case " $1 " in
    *" $2 "*) return 0 ;;
    *) return 1 ;;
  esac
}

archs_for() {
  lipo -archs "$1" 2>/dev/null || true
}

resolve_app_path() {
  if [ -d "$target_path" ] && [ "${target_path%.app}" != "$target_path" ]; then
    printf '%s\n' "$target_path"
    return 0
  fi

  if [ ! -d "$target_path" ]; then
    fail "macOS app target does not exist: $target_path"
  fi

  while IFS= read -r -d '' app_path; do
    binary_path="$app_path/Contents/MacOS/Open CoDesign"
    [ -f "$binary_path" ] || continue
    binary_archs="$(archs_for "$binary_path")"
    if has_arch "$binary_archs" "$expected_macho"; then
      printf '%s\n' "$app_path"
      return 0
    fi
  done < <(find "$target_path" -type d -name 'Open CoDesign.app' -prune -print0)

  fail "no Open CoDesign.app with $expected_arch architecture found under $target_path"
}

app_path="$(resolve_app_path)"
main_binary="$app_path/Contents/MacOS/Open CoDesign"

[ -f "$main_binary" ] || fail "missing main binary: $main_binary"

main_archs="$(archs_for "$main_binary")"
[ -n "$main_archs" ] || fail "could not read Mach-O architectures for $main_binary"
has_arch "$main_archs" "$expected_macho" ||
  fail "main binary does not contain $expected_arch ($expected_macho): $main_archs"

sqlite_hits="$(
  find "$app_path" \
    \( -iname '*better-sqlite3*' -o -iname '*better_sqlite3*' -o -iname '*install-sqlite*' \) \
    -print
)"
if [ -n "$sqlite_hits" ]; then
  log "$sqlite_hits"
  fail "packaged app still contains SQLite-native packaging residue"
fi

node_count=0
while IFS= read -r -d '' node_file; do
  node_count=$((node_count + 1))
  node_archs="$(archs_for "$node_file")"
  [ -n "$node_archs" ] || fail "could not read Mach-O architectures for native module: $node_file"
  has_arch "$node_archs" "$expected_macho" ||
    fail "native module is missing $expected_arch ($expected_macho): $node_file has $node_archs"
done < <(find "$app_path" -type f -name '*.node' -print0)

if [ "$print_binary" = "1" ]; then
  printf '%s\n' "$main_binary"
else
  log "Verified $expected_arch app: $app_path"
  log "Main binary architectures: $main_archs"
  log "Native modules checked: $node_count"
fi
