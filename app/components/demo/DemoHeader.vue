<script setup lang="ts">
import { BingButton, BingIcon } from '@moubing/bing-ui'
import { Moon, Sun } from 'lucide-vue-next'

const { theme, setTheme } = useAppTheme()
function toggleTheme() {
  const dark = theme.value === 'dark' || (theme.value === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  setTheme(dark ? 'light' : 'dark')
}
</script>

<template>
  <header class="app-header">
    <a class="app-skip-link" href="#app-content">跳到主要内容</a>
    <div class="app-header__inner">
      <NuxtLink to="/demo" :prefetch="false" class="app-brand" aria-label="文档看板游客体验">
        <img src="/requirement-board-logo.png" width="34" height="34" alt="" draggable="false">
        <span>文档看板</span>
      </NuxtLink>
      <div class="app-header__actions">
        <BingButton variant="ghost" size="lg" aria-label="切换亮暗主题" title="切换亮暗主题" @click="toggleTheme">
          <BingIcon :icon="theme === 'dark' ? Sun : Moon" :size="18" decorative />
        </BingButton>
        <NuxtLink to="/login" :prefetch="false" class="app-header__login">进入正式应用</NuxtLink>
      </div>
    </div>
  </header>
</template>
