<script setup lang="ts">
import { computed } from 'vue'
import { BingIcon } from '@moubing/bing-ui'
import { Bug, Clock3, FileText, ListChecks, UserCheck } from 'lucide-vue-next'
import { DOCUMENT_TYPE_LABELS } from '#shared/documents/workflow'
import { PRIORITY_LABELS } from '#shared/requirements/properties'
import { idleDays, staleLevel, type WorkbenchFlowCard } from '#shared/workbench/home'

const props = defineProps<{ card: WorkbenchFlowCard; now: string; overlay?: boolean }>()
const TYPE_ICONS = { requirement: FileText, defect: Bug, todo: ListChecks } as const
const BARS = { high: 3, medium: 2, low: 1 } as const
const stale = computed(() => props.card.verify ? null : staleLevel(props.card.status.code, props.card.lastActivityAt, props.now))
const idle = computed(() => idleDays(props.card.lastActivityAt, props.now))
const updated = computed(() => {
  const minutes = Math.max(0, Math.floor((Date.parse(props.now) - Date.parse(props.card.lastActivityAt)) / 60_000))
  return minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前` : `${Math.floor(minutes / 1440)} 天前`
})
const people = computed(() => props.card.assignees.map(person => person.name).join('、') || '未指派')
const showPeople = computed(() => !props.card.mine || props.card.assignees.length > 1)
</script>

<template>
  <div class="flow-card" :class="[`is-${card.priority}`, `is-${card.documentType}`, { 'is-overlay': overlay, 'is-verify': card.verify }]">
    <!-- 整卡链接与菜单共用动效层，避免 translate/opacity 把菜单压到链接下面。 -->
    <slot name="open" />
    <div class="flow-card__top">
     <span class="flow-card__identity">
      <span class="flow-card__type" :title="DOCUMENT_TYPE_LABELS[card.documentType]">
        <BingIcon :icon="TYPE_ICONS[card.documentType as keyof typeof TYPE_ICONS] ?? FileText" :size="14" decorative />
        <span class="visually-hidden">{{ DOCUMENT_TYPE_LABELS[card.documentType] }}</span>
      </span>
      <span class="flow-card__key">{{ card.key }}</span>
      <span class="flow-card__priority" :title="`${PRIORITY_LABELS[card.priority]}优先级`">
        <i v-for="bar in 3" :key="bar" :class="{ 'is-on': bar <= BARS[card.priority] }" aria-hidden="true" />
        <span class="visually-hidden">{{ PRIORITY_LABELS[card.priority] }}优先级</span>
      </span>
     </span>
     <span class="flow-card__meta" :class="{ 'is-ordinary': !showPeople && !card.verify && !stale }">
      <span v-if="showPeople" class="flow-card__people" :title="`负责人：${people}`">
        <span class="flow-card__avatars" aria-hidden="true">
          <span v-for="person in card.assignees.slice(0, 3)" :key="person.id" class="flow-avatar" :style="{ '--avatar': person.avatarColor }">{{ Array.from(person.name)[0] }}</span>
          <span v-if="card.assignees.length > 3" class="flow-avatar is-more">+{{ card.assignees.length - 3 }}</span>
          <span v-if="!card.assignees.length" class="flow-avatar is-empty">?</span>
        </span>
        <span class="flow-card__people-count" aria-hidden="true">{{ card.assignees.length || '?' }}<span v-if="card.assignees.length">人</span></span>
      </span>
      <span v-if="card.verify" class="flow-card__flag is-verify"><BingIcon class="flow-card__flag-icon" :icon="UserCheck" :size="13" decorative />等你验证</span>
      <span v-else-if="stale" class="flow-card__flag" :class="`is-${stale}`" :title="`${idle} 天没有进展`">
        <BingIcon class="flow-card__flag-icon" :icon="Clock3" :size="13" decorative />{{ idle }} 天<span class="visually-hidden">没有进展</span>
      </span>
      <span v-else class="flow-card__time">{{ updated }}</span>
     </span>
      <span v-if="$slots.menu || overlay" class="flow-card__menu"><slot name="menu" /></span>
    </div>
    <p class="flow-card__title">{{ card.title }}</p>
    <span :id="overlay ? undefined : `flow-people-${card.id}`" class="visually-hidden">负责人：{{ people }}</span>
  </div>
</template>

<style scoped>
.flow-card {
  --type: var(--ui-accent);
  --priority: var(--bing-muted);
  --card-border: color-mix(in srgb, var(--bing-border) 75%, transparent);
  position: relative; display: grid; gap: 8px; padding: 10px;
  border: 1px solid var(--card-border); border-radius: 8px; background: var(--bing-surface-solid);
  box-shadow: 0 1px 2px rgb(15 23 42 / 0.04);
  color: var(--bing-text); font-size: 13px; line-height: 1.5;
  transition: border-color 140ms ease, box-shadow 140ms ease, translate 140ms ease;
}
.flow-card.is-defect { --type: light-dark(#d14343, #ff8a8a); }
.flow-card.is-todo { --type: light-dark(#7c4dce, #b99bff); }
.flow-card.is-high { --priority: var(--bing-danger-strong); }
.flow-card.is-medium { --priority: var(--bing-warning-strong); }
.flow-card.is-verify { --card-border: color-mix(in srgb, #0891b2 38%, var(--bing-border)); background: color-mix(in srgb, #0891b2 4%, var(--bing-surface-solid)); }
.flow-card.is-overlay {
  height: 100%; box-sizing: border-box; border-color: color-mix(in srgb, var(--ui-accent) 35%, var(--bing-border));
  box-shadow: 0 22px 40px -16px rgb(15 23 42 / 0.4), 0 4px 10px -2px rgb(15 23 42 / 0.12);
}
.flow-card__top { display: flex; align-items: center; gap: 6px; min-height: 24px; min-width: 0; color: var(--bing-muted); font-size: 12px; }
.flow-card__identity { display: inline-flex; flex: none; align-items: center; gap: 6px; }
.flow-card__meta { display: inline-flex; flex: none; align-items: center; gap: 6px; margin-left: auto; }
.flow-card__type { display: grid; flex: none; place-items: center; width: 20px; height: 20px; border-radius: 5px; background: color-mix(in srgb, var(--type) 10%, transparent); color: var(--type); }
.flow-card__key { flex: none; color: var(--bing-muted); font-weight: 500; font-variant-numeric: tabular-nums; white-space: nowrap; }
.flow-card__priority { display: inline-flex; align-items: flex-end; gap: 2px; height: 12px; }
.flow-card__priority i { width: 3px; border-radius: 1px; background: color-mix(in srgb, var(--bing-muted) 28%, transparent); }
.flow-card__priority i:nth-child(1) { height: 5px; }
.flow-card__priority i:nth-child(2) { height: 8px; }
.flow-card__priority i:nth-child(3) { height: 12px; }
.flow-card__priority i.is-on { background: var(--priority); }
.flow-card__menu { position: relative; z-index: 2; flex: none; margin-block: -2px; display: flex; }
.flow-card.is-overlay .flow-card__menu { width: 24px; }
.flow-card__title {
  margin: 0; color: var(--bing-heading); font-size: 14px; font-weight: 600; line-height: 1.45;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere;
}
.flow-card__people { display: flex; flex: none; }
.flow-card__avatars { display: flex; }
.flow-card__people-count { display: none; align-items: center; gap: 2px; white-space: nowrap; color: var(--bing-muted); }
.flow-avatar { display: inline-grid; place-items: center; width: 22px; height: 22px; margin-left: -5px; border: 2px solid var(--bing-surface-solid); border-radius: 50%; background: var(--avatar, var(--bing-muted)); color: #fff; font-size: 11px; font-weight: 700; }
.flow-avatar:first-of-type { margin-left: 0; }
.flow-avatar.is-more { background: var(--ui-navigation); color: var(--bing-muted); font-size: 10px; }
.flow-avatar.is-empty { border: 1px dashed var(--bing-muted); background: none; color: var(--bing-muted); }
.flow-card__flag { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: 999px; font-weight: 600; white-space: nowrap; }
.flow-card__flag, .flow-card__time { flex: none; }
.flow-card__flag.is-warn { color: var(--bing-warning-strong); background: var(--bing-warning-soft); }
.flow-card__flag.is-danger { color: var(--bing-danger-strong); background: var(--bing-danger-soft); }
.flow-card__flag.is-verify { color: light-dark(#0e7490, #67d4ea); background: color-mix(in srgb, #0891b2 12%, transparent); }
.flow-card__time { font-variant-numeric: tabular-nums; white-space: nowrap; }
@container (max-width: 340px) {
  .flow-card__avatars { display: none; }
  .flow-card__people-count { display: inline-flex; }
  .flow-card__time { display: none; }
  .flow-card__meta.is-ordinary { display: none; }
  .flow-card__meta.is-ordinary + .flow-card__menu { margin-left: auto; }
}
/* 窄卡片的提醒换到第二行，编号和菜单始终完整。 */
@container (max-width: 250px) {
  .flow-card { padding: 8px; }
  .flow-card__top, .flow-card__identity { gap: 4px; }
  .flow-card__type { width: 16px; background: none; }
  .flow-card__flag { padding-inline: 5px; font-size: 12px; }
  .flow-card__flag-icon { display: none; }
  .flow-card__top { flex-wrap: wrap; }
  .flow-card__identity { flex: 1; }
  .flow-card__meta { order: 1; flex-basis: 100%; justify-content: space-between; margin-left: 0; }
}
@media (pointer: coarse) { .flow-card.is-overlay .flow-card__menu { width: 44px; min-height: 44px; } }
@media (prefers-reduced-motion: reduce) { .flow-card { transition: none; } }
</style>
