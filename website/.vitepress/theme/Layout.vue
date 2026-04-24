<script setup lang="ts">
import { useData } from 'vitepress';
import DefaultTheme from 'vitepress/theme';

const { Layout } = DefaultTheme;
const { frontmatter } = useData();
</script>

<template>
  <Layout>
    <template #home-hero-after>
      <div v-if="frontmatter.layout === 'home'" class="codesign-hero-shot">
        <img
          :src="withBase('/screenshots/product-hero.png')"
          alt="Open CoDesign — chat on the left, live artifact on the right"
        />
      </div>
    </template>
  </Layout>
</template>
