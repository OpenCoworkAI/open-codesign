#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_TIMEOUT_SEC="${CODESIGN_DMG_BUILD_TIMEOUT_SEC:-900}"
BUILD_RETRIES="${CODESIGN_DMG_BUILD_RETRIES:-2}"

cleanup_open_codesign_volumes() {
  while IFS= read -r device; do
    [ -n "$device" ] || continue
    hdiutil detach -force "$device" >/dev/null 2>&1 || true
  done < <(
    hdiutil info 2>/dev/null |
      awk '/\/Volumes\/Open CoDesign/ { device=$1; sub(/s[0-9]+$/, "", device); print device }' |
      sort -u
  )
}

kill_tree() {
  local pid="$1"
  local child
  while IFS= read -r child; do
    [ -n "$child" ] || continue
    kill_tree "$child"
  done < <(pgrep -P "$pid" 2>/dev/null || true)
  kill -TERM "$pid" 2>/dev/null || true
}

run_once() {
  node "$SCRIPT_DIR/electron-builder-macos.cjs" "$@" &
  local pid="$!"
  local elapsed=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$elapsed" -ge "$BUILD_TIMEOUT_SEC" ]; then
      echo "::warning::macOS DMG build timed out after ${BUILD_TIMEOUT_SEC}s; cleaning up mounted images"
      kill_tree "$pid"
      sleep 2
      cleanup_open_codesign_volumes
      wait "$pid" 2>/dev/null || true
      return 124
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  wait "$pid"
}

attempt=1
while [ "$attempt" -le "$BUILD_RETRIES" ]; do
  cleanup_open_codesign_volumes
  if run_once "$@"; then
    exit 0
  fi
  status="$?"
  cleanup_open_codesign_volumes
  if [ "$attempt" -ge "$BUILD_RETRIES" ]; then
    exit "$status"
  fi
  echo "::warning::macOS DMG build failed on attempt ${attempt}/${BUILD_RETRIES}; retrying"
  sleep 10
  attempt=$((attempt + 1))
done
