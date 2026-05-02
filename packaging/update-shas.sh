#!/usr/bin/env bash
# Sync every distribution-channel manifest to a published GitHub Release.
#
# Reads SHA256SUMS.txt from the release (one GET — no re-downloading
# installers) and rewrites version strings, URLs, and checksums across
# homebrew cask, scoop, winget, and flatpak. Scoop prefers the Windows zip
# artifacts when present; older releases fall back to unpacking the nested
# electron-builder NSIS payload. For winget, auto-copies the previous version
# directory when the new one does not yet exist.
#
# Also derives the mac .app bundle name from apps/desktop/electron-builder.yml
# so that renaming productName (e.g. "open-codesign" → "Open CoDesign")
# propagates into the cask without manual edits.
#
# Usage:
#   ./packaging/update-shas.sh                  # use apps/desktop/package.json version
#   ./packaging/update-shas.sh 0.1.3            # override version
#   ./packaging/update-shas.sh 0.1.3 local/dir  # hash local files instead of downloading
#   PACKAGING_CHANNEL=scoop ./packaging/update-shas.sh 0.1.3

set -euo pipefail

VERSION="${1:-$(node -p "require('./apps/desktop/package.json').version" 2>/dev/null || echo '')}"
LOCAL_DIR="${2:-}"
PACKAGING_CHANNEL="${PACKAGING_CHANNEL:-all}"
if [[ -z "$VERSION" ]]; then
  echo "error: cannot determine VERSION (pass as arg 1 or ensure apps/desktop/package.json is readable)" >&2
  exit 1
fi
if [[ "$PACKAGING_CHANNEL" != "all" && "$PACKAGING_CHANNEL" != "scoop" ]]; then
  echo "error: PACKAGING_CHANNEL must be 'all' or 'scoop'" >&2
  exit 1
fi

REPO="OpenCoworkAI/open-codesign"
REL_URL_BASE="https://github.com/${REPO}/releases/download/v${VERSION}"

# Derive productName from electron-builder.yml. Everything downstream
# (mac .app bundle, Windows .exe after install) is named after this.
PRODUCT_NAME="$(awk -F': *' '/^productName:/ {sub(/^[ \t]+|[ \t]+$/, "", $2); print $2; exit}' apps/desktop/electron-builder.yml)"
if [[ -z "$PRODUCT_NAME" ]]; then
  echo "error: could not parse productName from apps/desktop/electron-builder.yml" >&2
  exit 1
fi
APP_BUNDLE="${PRODUCT_NAME}.app"
WIN_EXE_NAME="${PRODUCT_NAME}.exe"

# Actual artifact filenames (from electron-builder.yml `artifactName` fields).
MAC_ARM64_DMG="open-codesign-${VERSION}-arm64.dmg"
MAC_X64_DMG="open-codesign-${VERSION}-x64.dmg"
WIN_X64_EXE="open-codesign-${VERSION}-x64-setup.exe"
WIN_ARM64_EXE="open-codesign-${VERSION}-arm64-setup.exe"
WIN_X64_ZIP="open-codesign-${VERSION}-x64.zip"
WIN_ARM64_ZIP="open-codesign-${VERSION}-arm64.zip"
LINUX_APPIMAGE="open-codesign-${VERSION}-x64.AppImage"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

echo "Version : v${VERSION}"
echo "Product : ${PRODUCT_NAME}"
echo "Channel : ${PACKAGING_CHANNEL}"
echo ""

# ---------------------------------------------------------------
# 1. Pull checksums. Prefer the signed SHA256SUMS.txt asset (fast,
#    one GET, already computed on the release runner); fall back to
#    re-hashing the artifacts if it's missing.
# ---------------------------------------------------------------
sums_file="$tmpdir/SHA256SUMS.txt"
if [[ -n "$LOCAL_DIR" && -f "$LOCAL_DIR/SHA256SUMS.txt" ]]; then
  cp "$LOCAL_DIR/SHA256SUMS.txt" "$sums_file"
else
  url="${REL_URL_BASE}/SHA256SUMS.txt"
  echo "Fetching ${url}"
  if ! curl -fsSL -o "$sums_file" "$url"; then
    echo "  SHA256SUMS.txt not published — rehashing installers instead" >&2
    : > "$sums_file"
    required_artifacts=("$WIN_X64_EXE" "$WIN_ARM64_EXE")
    if [[ "$PACKAGING_CHANNEL" == "all" ]]; then
      required_artifacts=("$MAC_ARM64_DMG" "$MAC_X64_DMG" "${required_artifacts[@]}" "$LINUX_APPIMAGE")
    fi
    for f in "${required_artifacts[@]}"; do
      out="$tmpdir/$f"
      if [[ -n "$LOCAL_DIR" && -f "$LOCAL_DIR/$f" ]]; then
        cp "$LOCAL_DIR/$f" "$out"
      else
        echo "  downloading $f"
        curl -fsSL -o "$out" "${REL_URL_BASE}/$f"
      fi
      printf '%s  %s\n' "$(shasum -a 256 "$out" | awk '{print $1}')" "$f" >> "$sums_file"
    done
    for f in "$WIN_X64_ZIP" "$WIN_ARM64_ZIP"; do
      out="$tmpdir/$f"
      if [[ -n "$LOCAL_DIR" && -f "$LOCAL_DIR/$f" ]]; then
        cp "$LOCAL_DIR/$f" "$out"
      elif curl -fsSL -o "$out" "${REL_URL_BASE}/$f"; then
        :
      else
        echo "  optional $f not published — Scoop will use the legacy NSIS fallback" >&2
        continue
      fi
      printf '%s  %s\n' "$(shasum -a 256 "$out" | awk '{print $1}')" "$f" >> "$sums_file"
    done
  fi
fi

lookup_sha() {
  local name="$1"
  local sha
  sha="$(awk -v n="$name" '$2 == n || $2 == "*"n {print $1; exit}' "$sums_file")"
  if [[ -z "$sha" ]]; then
    echo "error: no SHA256 for $name in release checksums" >&2
    return 1
  fi
  echo "$sha"
}

lookup_optional_sha() {
  local name="$1"
  awk -v n="$name" '$2 == n || $2 == "*"n {print $1; exit}' "$sums_file"
}

mac_arm_sha=""
mac_x64_sha=""
win_x64_sha="$(lookup_sha "$WIN_X64_EXE")"
win_arm_sha="$(lookup_sha "$WIN_ARM64_EXE")"
win_x64_zip_sha="$(lookup_optional_sha "$WIN_X64_ZIP")"
win_arm_zip_sha="$(lookup_optional_sha "$WIN_ARM64_ZIP")"
linux_sha=""

if [[ "$PACKAGING_CHANNEL" == "all" ]]; then
  mac_arm_sha="$(lookup_sha "$MAC_ARM64_DMG")"
  mac_x64_sha="$(lookup_sha "$MAC_X64_DMG")"
  linux_sha="$(lookup_sha "$LINUX_APPIMAGE")"
fi

if [[ -n "$win_x64_zip_sha" || -n "$win_arm_zip_sha" ]]; then
  if [[ -z "$win_x64_zip_sha" || -z "$win_arm_zip_sha" ]]; then
    echo "error: Scoop zip artifacts must be published for both x64 and arm64, or neither" >&2
    exit 1
  fi
  scoop_mode="zip"
else
  scoop_mode="legacy-nsis"
fi

if [[ "$PACKAGING_CHANNEL" == "all" ]]; then
  echo "  mac arm64      : $mac_arm_sha"
  echo "  mac x64        : $mac_x64_sha"
fi
echo "  win x64        : $win_x64_sha"
echo "  win arm64      : $win_arm_sha"
if [[ "$scoop_mode" == "zip" ]]; then
  echo "  win x64 zip    : $win_x64_zip_sha"
  echo "  win arm64 zip  : $win_arm_zip_sha"
fi
if [[ "$PACKAGING_CHANNEL" == "all" ]]; then
  echo "  linux AppImage : $linux_sha"
fi
echo ""

# ---------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------
# ---------------------------------------------------------------
# 2. Homebrew cask
# ---------------------------------------------------------------
cask="packaging/homebrew/Casks/open-codesign.rb"
if [[ "$PACKAGING_CHANNEL" == "all" ]]; then
  echo "Homebrew cask…"
  perl -pi -e "s/^(\\s*version\\s+)\"[^\"]+\"/\${1}\"${VERSION}\"/" "$cask"
  # The cask has two sha256 lines, one inside on_arm, one inside on_intel.
  # Rewriting both by matching the line after the arch-specific `url`.
  perl -0777 -pi -e "s/(on_arm do[\\s\\S]*?sha256\\s+)\"[^\"]+\"/\${1}\"${mac_arm_sha}\"/s" "$cask"
  perl -0777 -pi -e "s/(on_intel do[\\s\\S]*?sha256\\s+)\"[^\"]+\"/\${1}\"${mac_x64_sha}\"/s" "$cask"
  # Keep the installed .app bundle aligned with productName.
  perl -pi -e "s{^(\\s*app\\s+)\"[^\"]+\\.app\"}{\${1}\"${APP_BUNDLE}\"}" "$cask"
  # And the xattr caveat path.
  perl -pi -e "s{/Applications/[^\\s\"]+\\.app}{/Applications/${APP_BUNDLE}}g" "$cask"
fi

# ---------------------------------------------------------------
# 3. Scoop
# ---------------------------------------------------------------
echo "Scoop manifest… (${scoop_mode})"
scoop="packaging/scoop/bucket/open-codesign.json"
python3 - "$scoop" "$VERSION" "$scoop_mode" "$WIN_EXE_NAME" \
  "$WIN_X64_EXE" "$win_x64_sha" "$WIN_ARM64_EXE" "$win_arm_sha" \
  "$WIN_X64_ZIP" "${win_x64_zip_sha:-}" "$WIN_ARM64_ZIP" "${win_arm_zip_sha:-}" <<'PY'
import json
import sys
from collections import OrderedDict

(
    path,
    version,
    mode,
    win_exe_name,
    win_x64_exe,
    win_x64_sha,
    win_arm_exe,
    win_arm_sha,
    win_x64_zip,
    win_x64_zip_sha,
    win_arm_zip,
    win_arm_zip_sha,
) = sys.argv[1:]

base = f"https://github.com/OpenCoworkAI/open-codesign/releases/download/v{version}"
autoupdate_base = "https://github.com/OpenCoworkAI/open-codesign/releases/download/v$version"

with open(path, encoding="utf-8") as fh:
    manifest = json.load(fh, object_pairs_hook=OrderedDict)

manifest["version"] = version

if mode == "zip":
    manifest["architecture"] = OrderedDict(
        [
            ("64bit", OrderedDict([("url", f"{base}/{win_x64_zip}"), ("hash", win_x64_zip_sha)])),
            ("arm64", OrderedDict([("url", f"{base}/{win_arm_zip}"), ("hash", win_arm_zip_sha)])),
        ]
    )
    manifest.pop("extract_dir", None)
    manifest.pop("pre_install", None)
    manifest.pop("post_install", None)
    manifest["autoupdate"] = OrderedDict(
        [
            (
                "architecture",
                OrderedDict(
                    [
                        ("64bit", OrderedDict([("url", f"{autoupdate_base}/open-codesign-$version-x64.zip")])),
                        ("arm64", OrderedDict([("url", f"{autoupdate_base}/open-codesign-$version-arm64.zip")])),
                    ]
                ),
            )
        ]
    )
else:
    manifest["architecture"] = OrderedDict(
        [
            (
                "64bit",
                OrderedDict(
                    [
                        ("url", f"{base}/{win_x64_exe}#/dl.7z"),
                        ("hash", win_x64_sha),
                        ("installer", OrderedDict([("script", 'Expand-7zipArchive "$dir\\app-64.7z" "$dir"')])),
                    ]
                ),
            ),
            (
                "arm64",
                OrderedDict(
                    [
                        ("url", f"{base}/{win_arm_exe}#/dl.7z"),
                        ("hash", win_arm_sha),
                        ("installer", OrderedDict([("script", 'Expand-7zipArchive "$dir\\app-arm64.7z" "$dir"')])),
                    ]
                ),
            ),
        ]
    )
    manifest["extract_dir"] = "\\$PLUGINSDIR"
    manifest["pre_install"] = 'Get-ChildItem "$dir" -Exclude "app-64.7z", "app-arm64.7z" | Remove-Item -Force -Recurse'
    manifest["post_install"] = 'Remove-Item "$dir\\app-64.7z", "$dir\\app-arm64.7z" -ErrorAction SilentlyContinue'
    manifest["autoupdate"] = OrderedDict(
        [
            (
                "architecture",
                OrderedDict(
                    [
                        (
                            "64bit",
                            OrderedDict(
                                [("url", f"{autoupdate_base}/open-codesign-$version-x64-setup.exe#/dl.7z")]
                            ),
                        ),
                        (
                            "arm64",
                            OrderedDict(
                                [("url", f"{autoupdate_base}/open-codesign-$version-arm64-setup.exe#/dl.7z")]
                            ),
                        ),
                    ]
                ),
            )
        ]
    )

manifest["bin"] = [[win_exe_name, "open-codesign"]]
manifest["shortcuts"] = [[win_exe_name, "Open CoDesign"]]

key_order = [
    "version",
    "description",
    "homepage",
    "license",
    "architecture",
    "extract_dir",
    "pre_install",
    "bin",
    "shortcuts",
    "checkver",
    "autoupdate",
    "post_install",
]
ordered = OrderedDict()
for key in key_order:
    if key in manifest:
        ordered[key] = manifest[key]
for key, value in manifest.items():
    if key not in ordered:
        ordered[key] = value

with open(path, "w", encoding="utf-8") as fh:
    json.dump(ordered, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
PY

# ---------------------------------------------------------------
# 4. winget — auto-copy previous version directory if needed
# ---------------------------------------------------------------
winget_root="packaging/winget/manifests/o/OpenCoworkAI/OpenCoDesign"
winget_dir="${winget_root}/${VERSION}"
if [[ "$PACKAGING_CHANNEL" == "all" ]]; then
  echo "winget manifests…"
fi
if [[ "$PACKAGING_CHANNEL" == "all" && ! -d "$winget_dir" ]]; then
  prev="$(ls "$winget_root" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 || true)"
  if [[ -n "$prev" ]]; then
    echo "  creating $winget_dir from $prev"
    cp -R "${winget_root}/${prev}" "$winget_dir"
  else
    echo "  warning: no previous winget version directory to copy from — skipping"
  fi
fi

if [[ "$PACKAGING_CHANNEL" == "all" && -d "$winget_dir" ]]; then
  for f in "$winget_dir"/*.yaml; do
    perl -pi -e "s/^PackageVersion:.*/PackageVersion: ${VERSION}/" "$f"
  done
  installer="$winget_dir/OpenCoworkAI.OpenCoDesign.installer.yaml"
  # Rewrite the entire Installers block to the current (per-arch) shape.
  # electron-builder now emits separate x64 and arm64 NSIS installers.
  python3 - "$installer" "$VERSION" "$win_x64_sha" "$win_arm_sha" <<'PY'
import re, sys
path, version, x64, arm64 = sys.argv[1:]
src = open(path).read()
new_block = (
    "Installers:\n"
    f"  - Architecture: x64\n"
    f"    InstallerUrl: https://github.com/OpenCoworkAI/open-codesign/releases/download/v{version}/open-codesign-{version}-x64-setup.exe\n"
    f"    InstallerSha256: {x64.upper()}\n"
    f"  - Architecture: arm64\n"
    f"    InstallerUrl: https://github.com/OpenCoworkAI/open-codesign/releases/download/v{version}/open-codesign-{version}-arm64-setup.exe\n"
    f"    InstallerSha256: {arm64.upper()}\n"
)
out = re.sub(r"Installers:\n(?:(?:  -|    ).*\n)+", new_block, src, count=1)
open(path, "w").write(out)
PY
  locale="$winget_dir/OpenCoworkAI.OpenCoDesign.locale.en-US.yaml"
  [[ -f "$locale" ]] && perl -pi -e "s{releases/tag/v[0-9][0-9A-Za-z.\\-]*}{releases/tag/v${VERSION}}g" "$locale"
fi

# ---------------------------------------------------------------
# 5. Flatpak (manual Flathub PR; we just keep the template fresh)
# ---------------------------------------------------------------
flatpak="packaging/flatpak/ai.opencowork.codesign.yaml"
if [[ "$PACKAGING_CHANNEL" == "all" && -f "$flatpak" ]]; then
  echo "Flatpak manifest…"
  perl -pi -e "s{releases/download/v[0-9][0-9A-Za-z.\\-]*/open-codesign-[0-9][0-9A-Za-z.\\-]*-x64\\.AppImage}{releases/download/v${VERSION}/open-codesign-${VERSION}-x64.AppImage}g" "$flatpak"
  perl -pi -e "s/(sha256:\\s+)(REPLACE_WITH_[A-Z0-9_]+|[a-f0-9]{64})/\${1}${linux_sha}/g" "$flatpak"
  # Size: HEAD the release asset for Content-Length.
  size="$(curl -fsSLI "${REL_URL_BASE}/${LINUX_APPIMAGE}" | awk 'tolower($1)=="content-length:" {gsub("\r",""); print $2}' | tail -1 || true)"
  if [[ -n "${size:-}" ]]; then
    perl -pi -e "s/^(\\s+size:).*/\${1} ${size}/" "$flatpak"
  fi
fi

echo ""
echo "Done. Review with:  git diff packaging/"
