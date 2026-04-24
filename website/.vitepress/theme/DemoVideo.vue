<script setup lang="ts">
import { useData } from 'vitepress';
import { computed } from 'vue';

/**
 * Thin wrapper around <video> that resolves a public-folder URL through
 * VitePress's `base` config at runtime. Using `<source src="/demos/foo.mp4">`
 * directly in markdown triggers Rollup to resolve it as a module import,
 * which fails with the site's `/open-codesign/` base prefix.
 */
const props = defineProps<{
  /** Path under `website/public`, e.g. `/demos/app-showcase.mp4`. */
  src: string;
  /** Poster image, also public-folder relative. */
  poster?: string;
  /** Autoplay loop muted (hero variant); otherwise show controls. */
  hero?: boolean;
  /** Label read by screen readers / UA. */
  label?: string;
}>();

const { site } = useData();

const base = computed(() => site.value.base.replace(/\/$/, ''));
const _url = computed(() => `${base.value}${props.src}`);
const _posterUrl = computed(() => (props.poster ? `${base.value}${props.poster}` : undefined));
</script>

<template>
  <video
    v-if="hero"
    autoplay
    loop
    muted
    playsinline
    preload="metadata"
    :poster="posterUrl"
    :aria-label="label"
  >
    <source :src="url" type="video/mp4" />
  </video>
  <video
    v-else
    controls
    preload="metadata"
    :poster="posterUrl"
    :aria-label="label"
  >
    <source :src="url" type="video/mp4" />
  </video>
</template>
