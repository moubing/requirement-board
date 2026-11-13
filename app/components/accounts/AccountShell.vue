<script setup lang="ts">
defineProps<{ title: string; description?: string; compact?: boolean }>()
</script>

<template>
  <main class="account-page">
    <section class="account-main" :class="{ 'account-main--compact': compact }">
      <div class="account-heading">
        <div><h1>{{ title }}</h1><p v-if="description">{{ description }}</p></div>
        <slot name="actions" />
      </div>
      <slot />
    </section>
  </main>
</template>
