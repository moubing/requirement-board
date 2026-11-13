<script setup lang="ts">
import { computed } from 'vue'
import { Users } from 'lucide-vue-next'
import { BingCard, BingIcon, BingScrollbar, BingTag } from '@moubing/bing-ui'
import type { CollaborativeEditorOptions } from '../../composables/use-requirement-collaboration'

const props = defineProps<{
  participants: CollaborativeEditorOptions['user'][]
  currentUserId: string
  connection: string
}>()

const connected = computed(() => props.connection === 'connected')
const members = computed(() => [...props.participants].sort((left, right) => {
  if (left.id === props.currentUserId) return -1
  if (right.id === props.currentUserId) return 1
  return left.name.localeCompare(right.name, 'zh-CN') || left.id.localeCompare(right.id)
}))
const connectionMessage = computed(() => props.connection === 'connecting'
  ? '正在获取编辑成员…'
  : '连接已断开，暂时无法获取编辑人数')
const initial = (name: string) => Array.from(name.trim())[0]?.toLocaleUpperCase() || '?'
</script>

<template>
  <BingCard
    class="collaborators-panel"
    variant="plain"
    padding="md"
    rounded="sm"
    entrance="none"
    flip-trigger="none"
    :glass="false"
    :interactive="false"
    :tilt="false"
    :glare="false"
    role="region"
    aria-labelledby="requirement-collaborators-title"
  >
    <template #header>
      <div class="collaborators-panel__header">
        <h2 id="requirement-collaborators-title">
          <BingIcon :icon="Users" :size="18" decorative />
          正在编辑
        </h2>
        <BingTag
          v-if="connected"
          class="collaborators-panel__count"
          variant="soft"
          tone="secondary"
          size="sm"
          role="status"
          aria-live="polite"
          :aria-label="`${members.length} 人正在编辑`"
        >
          {{ members.length }} 人
        </BingTag>
      </div>
    </template>

    <p v-if="!connected" class="collaborators-panel__message" role="status">
      {{ connectionMessage }}
    </p>
    <p v-else-if="!members.length" class="collaborators-panel__message" role="status">
      当前暂无人编辑
    </p>
    <BingScrollbar v-else :max-height="216" aria-label="正在编辑的成员">
      <ul class="collaborators-panel__members">
        <li v-for="member in members" :key="member.id" class="collaborators-panel__member">
          <span class="collaborators-panel__avatar" :style="{ backgroundColor: member.color }" aria-hidden="true">
            {{ initial(member.name) }}
          </span>
          <span class="collaborators-panel__name" :title="member.name">{{ member.name }}</span>
          <BingTag v-if="member.id === currentUserId" variant="soft" tone="neutral" size="sm">我</BingTag>
          <span class="collaborators-panel__online" aria-hidden="true" />
        </li>
      </ul>
    </BingScrollbar>
  </BingCard>
</template>

<style scoped>
.collaborators-panel {
  min-width: 0;
}

.collaborators-panel__header,
.collaborators-panel__header h2,
.collaborators-panel__member {
  display: flex;
  align-items: center;
  gap: 10px;
}

.collaborators-panel__header {
  justify-content: space-between;
}

.collaborators-panel__header h2 {
  margin: 0;
  color: var(--rb-navy);
  font-size: 14px;
  line-height: 1.25;
}

.collaborators-panel__members {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.collaborators-panel__avatar {
  display: grid;
  flex: 0 0 32px;
  height: 32px;
  place-items: center;
  border-radius: 50%;
  color: white;
  font-size: 14px;
  font-weight: 600;
}

.collaborators-panel__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--rb-navy);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.collaborators-panel__online {
  flex: 0 0 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--bing-success-strong);
}

.collaborators-panel__message {
  margin: 0;
  color: var(--rb-muted);
  font-size: 13px;
  line-height: 1.6;
}
</style>
