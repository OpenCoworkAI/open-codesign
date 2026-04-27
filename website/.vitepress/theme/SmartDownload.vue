<script setup lang="ts">
import { onMounted, ref } from 'vue';
import pkg from '../../../package.json';

/**
 * Smart download row — detects the visitor's OS + CPU architecture and
 * renders a prominent "download the right asset" button, plus a secondary
 * row of links to the other platforms so nothing is hidden.
 *
 * Why a separate component rather than editing the hero action:
 * VitePress's hero is declarative frontmatter — it doesn't run Vue logic.
 * The hero button stays as a safe generic "Download" link to the Releases
 * page; this component lives directly under the hero and upgrades the
 * experience when JS is available. If JS is off (rare) the visitor just
 * uses the hero button and picks manually from the Releases page.
 *
 * Version is pulled from the workspace root package.json at build time so
 * the asset URLs always match the latest release tag. File names must
 * track electron-builder artifactName patterns in apps/desktop/electron-builder.yml.
 */

const latestVersion = (pkg as { version: string }).version;
const releasesBase = `https://github.com/OpenCoworkAI/open-codesign/releases/download/v${latestVersion}`;

type Asset = { label: string; file: string; size: string; url: string };

const macArm: Asset = {
  label: 'macOS · Apple Silicon',
  file: `open-codesign-${latestVersion}-arm64.dmg`,
  size: '135 MB',
  url: `${releasesBase}/open-codesign-${latestVersion}-arm64.dmg`,
};
const macIntel: Asset = {
  label: 'macOS · Intel',
  file: `open-codesign-${latestVersion}-x64.dmg`,
  size: '140 MB',
  url: `${releasesBase}/open-codesign-${latestVersion}-x64.dmg`,
};
const winX64: Asset = {
  label: 'Windows · x64',
  file: `open-codesign-${latestVersion}-x64-setup.exe`,
  size: '~110 MB',
  url: `${releasesBase}/open-codesign-${latestVersion}-x64-setup.exe`,
};
const winArm: Asset = {
  label: 'Windows · ARM64',
  file: `open-codesign-${latestVersion}-arm64-setup.exe`,
  size: '~100 MB',
  url: `${releasesBase}/open-codesign-${latestVersion}-arm64-setup.exe`,
};
const linuxAppImage: Asset = {
  label: 'Linux · AppImage (x64)',
  file: `open-codesign-${latestVersion}-x64.AppImage`,
  size: '~140 MB',
  url: `${releasesBase}/open-codesign-${latestVersion}-x64.AppImage`,
};
const linuxSnap: Asset = {
  label: 'Linux · Snap (x64)',
  file: `open-codesign-${latestVersion}-x64.snap`,
  size: '~140 MB',
  url: `${releasesBase}/open-codesign-${latestVersion}-x64.snap`,
};

const allAssets: Asset[] = [macArm, macIntel, winX64, winArm, linuxAppImage, linuxSnap];
const primary = ref<Asset | null>(null);
const detectedLabel = ref<string>('');
const isMac = ref(false);
const xattrCmd = 'xattr -cr "/Applications/Open CoDesign.app"';
const copied = ref(false);

async function copyXattr() {
  try {
    await navigator.clipboard.writeText(xattrCmd);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 1800);
  } catch {
    // Clipboard API refused (insecure context or no permission) — fall
    // through silently; the user can still triple-click the <code> to
    // select and copy manually.
  }
}

function detectPrimaryAsset(): { asset: Asset | null; label: string; mac: boolean } {
  if (typeof navigator === 'undefined') return { asset: null, label: '', mac: false };
  const ua = navigator.userAgent;
  // Prefer the higher-confidence signal when modern browsers expose it.
  const uaData = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  const platformHint = uaData?.platform?.toLowerCase() ?? '';

  const isMacUA = /mac/i.test(platformHint) || /Macintosh|Mac OS X/.test(ua);
  const isWin = /windows/i.test(platformHint) || /Windows NT/.test(ua);
  const isLinux = /linux/i.test(platformHint) || (!isMacUA && !isWin && /Linux/.test(ua));

  if (isMacUA) {
    // Intel Macs report "Intel" in navigator.cpuClass or UA; Apple Silicon
    // ships a UA string that no longer distinguishes — safer default on new
    // Macs is arm64 since Apple Silicon shipped in 2020 and Intel Macs are
    // dwindling. But when we CAN tell (old UA with "Intel Mac"), honor it.
    const looksIntel = /Intel Mac OS X/.test(ua) && !/AppleWebKit\/6(0[6-9]|[1-9][0-9])/.test(ua);
    return looksIntel
      ? { asset: macIntel, label: 'macOS · Intel detected', mac: true }
      : { asset: macArm, label: 'macOS · Apple Silicon detected', mac: true };
  }
  if (isWin) {
    const isArm = /ARM64|aarch64/i.test(ua) || /arm/i.test(platformHint);
    return isArm
      ? { asset: winArm, label: 'Windows · ARM64 detected', mac: false }
      : { asset: winX64, label: 'Windows · x64 detected', mac: false };
  }
  if (isLinux) return { asset: linuxAppImage, label: 'Linux detected', mac: false };
  return { asset: null, label: '', mac: false };
}

onMounted(() => {
  const { asset, label, mac } = detectPrimaryAsset();
  primary.value = asset;
  detectedLabel.value = label;
  isMac.value = mac;
});

const secondaryAssets = () => {
  const p = primary.value;
  return p ? allAssets.filter((a) => a.file !== p.file) : allAssets;
};
</script>

<template>
  <div class="smart-download">
    <div v-if="primary" class="primary-row">
      <a :href="primary.url" class="primary-button" :download="primary.file">
        <span class="primary-label">下载 · {{ primary.label }}</span>
        <span class="primary-meta">{{ primary.file }} · {{ primary.size }}</span>
      </a>
      <p class="detected-note">{{ detectedLabel }} · v{{ latestVersion }}</p>

      <div v-if="isMac" class="macos-gatekeeper" role="note" aria-label="macOS 安装步骤">
        <div class="macos-gatekeeper-header">
          <span class="macos-gatekeeper-icon" aria-hidden="true">⚠️</span>
          <strong>打不开 / "damaged, move to Trash"?</strong>
        </div>
        <ol class="macos-gatekeeper-steps">
          <li>把 <b>Open CoDesign</b> 拖到 <b>/Applications</b></li>
          <li>Sequoia 15+ 会拦下首次启动。终端跑一次下面这行，然后双击就能开：</li>
        </ol>
        <button
          type="button"
          class="macos-gatekeeper-cmd"
          @click="copyXattr"
          :aria-label="copied ? 'Copied' : '点击复制命令'"
        >
          <code>{{ xattrCmd }}</code>
          <span class="macos-gatekeeper-copy">{{ copied ? '✓ 已复制' : '复制 / Copy' }}</span>
        </button>
        <p class="macos-gatekeeper-foot">
          v0.1 未签名 / notarized——开源项目签名成本较高，Stage 2 路线图中。<br/>
          0.1.2 及更早 build 路径是 <code>/Applications/open-codesign.app</code>。
        </p>
      </div>
    </div>

    <details class="other-platforms">
      <summary>其他平台 / Other platforms</summary>
      <ul>
        <li v-for="asset in secondaryAssets()" :key="asset.file">
          <a :href="asset.url" :download="asset.file">
            {{ asset.label }}
            <span class="meta">{{ asset.size }}</span>
          </a>
        </li>
        <li class="releases-link">
          <a href="https://github.com/OpenCoworkAI/open-codesign/releases">
            所有版本 / All releases on GitHub →
          </a>
        </li>
      </ul>
    </details>

    <div v-if="!isMac" class="other-install-hint">
      <strong>macOS 用户</strong>：下载 <code>.dmg</code> 后，Sequoia 15+ 装完需要跑一次
      <code>xattr -cr "/Applications/Open CoDesign.app"</code> 才能双击打开。<br/>
      <strong>Windows</strong>：SmartScreen → 更多信息 → 仍要运行。
    </div>
  </div>
</template>

<style scoped>
.smart-download {
  max-width: 760px;
  margin: 1.5rem auto 2.5rem;
  padding: 0 1.5rem;
}

.primary-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
}

.primary-button {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 1rem 2rem;
  border-radius: 12px;
  background: var(--vp-c-brand-1, #c96442);
  color: #fff !important;
  font-weight: 600;
  text-decoration: none !important;
  transition:
    transform 120ms ease-out,
    box-shadow 160ms ease,
    background-color 120ms ease;
  box-shadow: 0 2px 0 rgba(0, 0, 0, 0.04), 0 8px 24px -8px rgba(201, 100, 66, 0.35);
}
.primary-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 2px 0 rgba(0, 0, 0, 0.04), 0 12px 28px -8px rgba(201, 100, 66, 0.45);
  background: var(--vp-c-brand-2, #b8583a);
}
.primary-button:active {
  transform: scale(0.98);
}
.primary-label {
  font-size: 1.05rem;
  letter-spacing: -0.01em;
}
.primary-meta {
  font-size: 0.8rem;
  font-weight: 400;
  opacity: 0.85;
  font-variant-numeric: tabular-nums;
}
.detected-note {
  font-size: 0.8rem;
  color: var(--vp-c-text-2, #6b6b6b);
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.other-platforms {
  margin: 1rem auto 0;
  max-width: 520px;
  font-size: 0.88rem;
  color: var(--vp-c-text-2, #6b6b6b);
}
.other-platforms summary {
  cursor: pointer;
  text-align: center;
  padding: 0.4rem 0;
  user-select: none;
  transition: color 120ms ease;
}
.other-platforms summary:hover {
  color: var(--vp-c-text-1, #1a1a1a);
}
.other-platforms ul {
  list-style: none;
  padding: 0.75rem 0 0;
  margin: 0;
}
.other-platforms li {
  padding: 0.35rem 0;
  border-bottom: 1px solid var(--vp-c-divider, rgba(0, 0, 0, 0.08));
}
.other-platforms li:last-child {
  border-bottom: none;
}
.other-platforms a {
  color: var(--vp-c-text-1, #1a1a1a);
  text-decoration: none;
  display: flex;
  justify-content: space-between;
  padding: 0.15rem 0;
}
.other-platforms a:hover {
  color: var(--vp-c-brand-1, #c96442);
}
.other-platforms .meta {
  color: var(--vp-c-text-3, #9a9a9a);
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
}
.other-platforms .releases-link a {
  justify-content: center;
  font-weight: 500;
  color: var(--vp-c-brand-1, #c96442);
}

.install-hint,
.other-install-hint {
  max-width: 640px;
  margin: 1.2rem auto 0;
  padding: 0.75rem 1rem;
  border-left: 3px solid var(--vp-c-brand-1, #c96442);
  background: rgba(201, 100, 66, 0.05);
  font-size: 0.82rem;
  line-height: 1.6;
  color: var(--vp-c-text-2, #6b6b6b);
  border-radius: 0 6px 6px 0;
}
.install-hint code,
.other-install-hint code {
  display: inline-block;
  padding: 0.1rem 0.4rem;
  margin: 0.2rem 0;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 4px;
  font-size: 0.78rem;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-1, #1a1a1a);
}
.install-hint strong,
.other-install-hint strong {
  color: var(--vp-c-text-1, #1a1a1a);
}

/* macOS-specific Gatekeeper block, shown inline right under the primary
 * download button. Warmer color + a copy-button for the xattr one-liner
 * so users don't need to hand-type it.
 */
.macos-gatekeeper {
  width: 100%;
  max-width: 540px;
  margin: 1rem auto 0;
  padding: 0.85rem 1rem 0.9rem;
  border: 1px solid rgba(201, 100, 66, 0.35);
  background: rgba(201, 100, 66, 0.06);
  border-radius: 10px;
  color: var(--vp-c-text-1, #1a1a1a);
  text-align: left;
  font-size: 0.88rem;
  line-height: 1.55;
}
.macos-gatekeeper-header {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.92rem;
}
.macos-gatekeeper-header strong {
  color: var(--vp-c-text-1, #1a1a1a);
}
.macos-gatekeeper-icon {
  font-size: 1.05rem;
  line-height: 1;
}
.macos-gatekeeper-steps {
  margin: 0.55rem 0 0.65rem;
  padding-left: 1.25rem;
  color: var(--vp-c-text-2, #6b6b6b);
}
.macos-gatekeeper-steps li {
  margin: 0.2rem 0;
}
.macos-gatekeeper-cmd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  padding: 0.55rem 0.75rem;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: #1a1a1a;
  border-radius: 6px;
  cursor: pointer;
  font-family: var(--vp-font-family-mono);
  font-size: 0.8rem;
  color: #f5f5f5;
  transition: border-color 120ms ease, transform 80ms ease;
}
.macos-gatekeeper-cmd:hover {
  border-color: var(--vp-c-brand-1, #c96442);
}
.macos-gatekeeper-cmd:active {
  transform: scale(0.99);
}
.macos-gatekeeper-cmd code {
  background: transparent;
  color: inherit;
  padding: 0;
  font-size: inherit;
  overflow-x: auto;
  white-space: nowrap;
}
.macos-gatekeeper-copy {
  flex-shrink: 0;
  padding: 0.15rem 0.45rem;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  font-size: 0.72rem;
  font-family: var(--vp-font-family-base);
  letter-spacing: 0.02em;
}
.macos-gatekeeper-foot {
  margin: 0.7rem 0 0;
  font-size: 0.74rem;
  color: var(--vp-c-text-3, #9a9a9a);
  line-height: 1.5;
}
.macos-gatekeeper-foot code {
  display: inline;
  padding: 0.05rem 0.3rem;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 3px;
  font-size: 0.72rem;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-2, #6b6b6b);
}

/* Dark mode adjustments for the command box */
.dark .macos-gatekeeper-cmd {
  background: #000;
  border-color: rgba(255, 255, 255, 0.12);
}
.dark .macos-gatekeeper-foot code {
  background: rgba(255, 255, 255, 0.08);
}
</style>
