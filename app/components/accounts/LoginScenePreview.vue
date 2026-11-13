<script setup lang="ts">
import { computed } from 'vue'
import { BingIcon } from '@moubing/bing-ui'
import { ArrowRight, Check, ChevronRight, FileText, MessageSquare, Sparkles } from 'lucide-vue-next'

const props = defineProps<{
  scene: number
  state: 'idle' | 'submitting' | 'success' | 'error'
  paused: boolean
  staticFrame: boolean
}>()
const scenes = ['collaboration', 'versions', 'ai']
const status = computed(() => props.state === 'success' ? '已完成' : props.state === 'submitting' ? '同步中…' : '进行中')
const lines = ['支持多人同时编辑，', '每一次修改都有迹可循。']
</script>

<template>
  <div class="login-preview" :class="{ 'is-static': staticFrame }" :data-scene="scenes[scene]" :data-paused="paused" :data-state="state" aria-hidden="true">
    <div class="preview-sheet" />
    <div class="preview-window">
      <div class="preview-toolbar">
        <span class="preview-breadcrumb"><BingIcon :icon="FileText" :size="15" decorative /> 团队空间 <BingIcon :icon="ChevronRight" :size="12" decorative /> 产品设计</span>
        <div class="preview-members"><span class="preview-avatar preview-avatar--blue">林</span><span class="preview-avatar preview-avatar--purple">青</span><small>共同编辑</small></div>
      </div>
      <div class="preview-document">
        <div class="preview-meta"><span>需求 <span class="preview-number">REQ-52</span></span><span class="preview-status" :class="{ 'is-complete': state === 'success', 'is-syncing': state === 'submitting' }"><BingIcon v-if="state === 'success'" :icon="Check" :size="12" decorative /><i v-else />{{ status }}</span></div>
        <div class="preview-title"><h3>文档协作体验优化</h3><span v-if="scene === 1" class="preview-versions">v2 <BingIcon :icon="ArrowRight" :size="12" decorative /> <b>v3</b></span><span v-else class="preview-version">v3</span></div>
        <div class="preview-stage">
          <div v-if="scene === 0" class="preview-collaboration">
            <p class="preview-lead">把团队的想法写在同一页。</p>
            <div v-for="(line, index) in lines" :key="line" class="preview-typing" :class="index === 0 ? 'is-blue' : 'is-purple'" :style="{ '--typing-delay': `${index === 0 ? 500 : 1900}ms`, '--typing-duration': `${line.length * 65}ms`, '--cursor-end': `${line.length}em`, '--characters': line.length }">
              <span v-for="(letter, position) in line" :key="position" class="preview-letter" :style="{ '--letter-delay': `${(index === 0 ? 500 : 1900) + position * 65}ms` }">{{ letter }}</span>
              <span class="preview-caret"><span>{{ index === 0 ? '小林' : '阿青' }}</span></span>
            </div>
            <div class="preview-collaboration-note"><span class="preview-presence" />两个人，一个共同的答案。</div>
          </div>
          <div v-else-if="scene === 1" class="preview-diff">
            <p class="preview-lead">把团队的想法写在同一页。</p>
            <div class="preview-diff-line preview-diff-line--removed"><span>−</span><del>修改后，手动保存并发送给同事。</del></div>
            <div class="preview-diff-line preview-diff-line--added"><span>+</span><ins>共同编辑，自动同步每一次修改。</ins></div>
            <div class="preview-diff-summary"><span>+ 1 处新增</span><span>− 1 处删除</span><small>修改前后，清楚可见。</small></div>
          </div>
          <div v-else class="preview-ai">
            <div class="preview-ai-copy">
              <p class="preview-ai-before">让文档更好用。</p>
              <p class="preview-ai-after">集中记录需求与讨论，<br>让每次修改都有清晰的来路。</p>
              <span class="preview-annotation-anchor">1</span>
            </div>
            <div class="preview-annotation">
              <div class="preview-annotation-title"><span><BingIcon :icon="Sparkles" :size="13" decorative /> AI 协作</span><span class="preview-annotation-count">1 条标注</span></div>
              <p>补充具体的协作方式和用户价值。</p>
              <div class="preview-annotation-result"><span class="preview-ai-pending"><BingIcon :icon="MessageSquare" :size="12" decorative /> 待处理</span><span class="preview-ai-done"><BingIcon :icon="Check" :size="12" decorative /> 已处理</span></div>
            </div>
          </div>
        </div>
      </div>
      <div class="preview-footer"><span><BingIcon :icon="Check" :size="12" decorative /> {{ state === 'submitting' ? '正在同步修改…' : state === 'success' ? '协作完成' : '所有更改已同步' }}</span><span>{{ scene === 0 ? '2 人在线' : scene === 1 ? '版本记录' : '标注与正文，一起更新' }}</span></div>
    </div>
  </div>
</template>

<style scoped>
.login-preview { position: relative; height: 100%; padding: 0 10px 16px 0; --collaborator-blue: #2b6ef3; --collaborator-purple: #7c3aed; }
.preview-sheet { position: absolute; inset: 13px 0 5px 14px; border: 1px solid var(--rb-border); border-radius: 12px; background: color-mix(in srgb, var(--rb-panel) 65%, var(--bing-canvas)); transform: translate(calc(var(--parallax-x, 0px) * -.4), calc(var(--parallax-y, 0px) * -.4)) rotate(1.5deg); transition: transform 220ms ease-out; }
.preview-window { position: relative; height: 100%; overflow: hidden; border: 1px solid var(--rb-border); border-radius: 12px; color: var(--rb-ink); background: var(--rb-panel); box-shadow: 0 14px 40px rgb(0 0 0 / .045); transform: translate(var(--parallax-x, 0px), var(--parallax-y, 0px)); transition: transform 220ms ease-out; }
.preview-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 44px; padding: 0 20px; border-bottom: 1px solid var(--rb-border); background: color-mix(in srgb, var(--bing-canvas) 55%, var(--rb-panel)); }
.preview-breadcrumb { display: flex; align-items: center; gap: 6px; color: var(--rb-muted); font-size: 10px; white-space: nowrap; }
.preview-members { display: flex; align-items: center; padding-left: 5px; }
.preview-avatar { display: grid; place-items: center; width: 23px; height: 23px; margin-left: -5px; border: 2px solid var(--rb-panel); border-radius: 50%; color: #fff; font-size: 9px; font-weight: 700; }
.preview-avatar--blue { background: var(--collaborator-blue); }
.preview-avatar--purple { background: var(--collaborator-purple); }
.preview-members small { margin-left: 7px; font-size: 9px; color: var(--rb-muted); }
.preview-document { padding: 18px 24px 0; }
.preview-meta { display: flex; align-items: center; justify-content: space-between; color: var(--rb-muted); font-size: 10px; line-height: 18px; }
.preview-number { padding-left: 7px; }
.preview-status { display: flex; align-items: center; gap: 5px; padding: 1px 7px; border-radius: 4px; color: color-mix(in srgb, var(--bing-secondary-strong) 60%, var(--rb-ink)); background: var(--bing-secondary-soft); transition: color 180ms, background-color 180ms; }
.preview-status i, .preview-presence { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.preview-status.is-complete { color: color-mix(in srgb, var(--bing-success-strong) 60%, var(--rb-ink)); background: var(--bing-success-soft); }
.preview-status.is-syncing { color: color-mix(in srgb, var(--bing-warning-strong) 60%, var(--rb-ink)); background: var(--bing-warning-soft); }
.preview-title { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.preview-title h3 { margin: 0; color: var(--rb-navy); font-size: 18px; font-weight: 700; line-height: 1.5; }
.preview-version { color: var(--rb-muted); font-size: 10px; }
.preview-versions { display: flex; align-items: center; gap: 6px; color: var(--rb-muted); font-size: 10px; animation: preview-appear 240ms 150ms both; }
.preview-versions b { color: var(--rb-ink); }
.preview-stage { position: relative; height: 164px; margin-top: 14px; font-size: 12px; line-height: 1.8; animation: preview-appear 180ms both; }
.preview-lead { margin: 0 0 12px; color: var(--rb-ink); }
.preview-typing { position: relative; padding-top: 17px; height: 44px; font-size: 13px; line-height: 22px; letter-spacing: 0; white-space: nowrap; }
.preview-typing.is-blue { --caret-color: var(--collaborator-blue); }
.preview-typing.is-purple { --caret-color: var(--collaborator-purple); }
.preview-letter { display: inline-block; width: 1em; animation: preview-appear 100ms var(--letter-delay) both; }
.preview-caret { position: absolute; top: 18px; left: 0; height: 18px; width: 2px; background: var(--caret-color); animation: preview-type var(--typing-duration) steps(var(--characters), end) var(--typing-delay) both, preview-appear 120ms var(--typing-delay) both; }
.preview-caret > span { position: absolute; bottom: 100%; left: 0; padding: 0 4px; border-radius: 3px 3px 3px 0; color: white; background: var(--caret-color); font-size: 9px; line-height: 15px; }
.preview-collaboration-note { display: flex; align-items: center; gap: 6px; margin-top: 12px; color: var(--rb-muted); font-size: 10px; }
.preview-presence { color: var(--bing-success-strong); }
.preview-diff-line { display: flex; gap: 10px; margin-top: 8px; padding: 6px 10px; border-radius: 4px; font-size: 12px; }
.preview-diff-line--removed { background: rgb(var(--bing-danger-rgb) / .22); animation: preview-rise 240ms 450ms both; }
.preview-diff-line--added { background: rgb(var(--bing-success-rgb) / .22); animation: preview-rise 300ms 1200ms both; }
.preview-diff-line del { text-decoration-thickness: 1px; }
.preview-diff-line ins { text-decoration: none; }
.preview-diff-summary { display: flex; align-items: center; gap: 12px; margin-top: 13px; font-size: 10px; animation: preview-appear 250ms 1900ms both; }
.preview-diff-summary > span:first-child { color: color-mix(in srgb, var(--bing-success-strong) 70%, var(--rb-ink)); }
.preview-diff-summary > span:nth-child(2) { color: color-mix(in srgb, var(--bing-danger-strong) 70%, var(--rb-ink)); }
.preview-diff-summary small { margin-left: auto; color: var(--rb-muted); font-size: 10px; }
.preview-ai-copy { position: relative; display: grid; padding-left: 10px; border-left: 2px solid var(--bing-warning-strong); font-size: 12px; line-height: 1.8; }
.preview-ai-copy p { grid-area: 1 / 1; margin: 0; }
.preview-ai-before { animation: preview-replace-old 4s both; }
.preview-ai-after { animation: preview-replace-new 4s both; }
.preview-annotation-anchor { position: absolute; right: 0; top: 0; display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; color: color-mix(in srgb, var(--bing-warning-strong) 60%, var(--rb-ink)); background: var(--bing-warning-soft); font-size: 10px; }
.preview-annotation { position: absolute; right: 0; bottom: 6px; width: 248px; max-width: 86%; padding: 10px 12px; border: 1px solid var(--rb-border); border-radius: 7px; background: var(--rb-panel); box-shadow: 0 3px 10px rgb(0 0 0 / .035); transform: translate(calc(var(--parallax-x, 0px) * .3), calc(var(--parallax-y, 0px) * .3)); transition: transform 220ms ease-out; animation: preview-appear 300ms 350ms both; }
.preview-annotation::before { content: ''; position: absolute; width: 20px; height: 16px; top: -17px; right: 8px; border-right: 1px solid var(--rb-border); }
.preview-annotation-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 10px; }
.preview-annotation-title > span:first-child { display: flex; align-items: center; gap: 5px; font-weight: 700; }
.preview-annotation-count { color: var(--rb-muted); font-size: 9px; }
.preview-annotation p { margin: 7px 0 5px; font-size: 10px; }
.preview-annotation-result { display: grid; font-size: 10px; }
.preview-annotation-result > span { grid-area: 1 / 1; display: flex; align-items: center; gap: 4px; }
.preview-ai-pending { color: var(--rb-muted); animation: preview-replace-old 4s both; }
.preview-ai-done { color: color-mix(in srgb, var(--bing-success-strong) 70%, var(--rb-ink)); animation: preview-replace-new 4s both; }
.preview-footer { position: absolute; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: space-between; height: 29px; padding: 0 20px; border-top: 1px solid var(--rb-border); color: var(--rb-muted); font-size: 9px; }
.preview-footer > span:first-child { display: flex; align-items: center; gap: 5px; }
.login-preview[data-paused="true"] *, .login-preview[data-paused="true"] *::before { animation-play-state: paused; }
@keyframes preview-appear { from { opacity: 0; } to { opacity: 1; } }
@keyframes preview-rise { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
@keyframes preview-type { from { transform: translateX(0); } to { transform: translateX(var(--cursor-end)); } }
@keyframes preview-replace-old { 0%, 49% { opacity: 1; } 57%, 100% { opacity: 0; } }
@keyframes preview-replace-new { 0%, 54% { opacity: 0; } 65%, 100% { opacity: 1; } }
.is-static * { animation: none; }
.is-static .preview-caret { transform: translateX(var(--cursor-end)); }
.is-static .preview-ai-before, .is-static .preview-ai-pending { opacity: 0; }
.is-static .preview-ai-after, .is-static .preview-ai-done { opacity: 1; }
:global([data-bing-theme="dark"] .login-preview) { --collaborator-purple: #7040c8; }
@media (max-width: 1199px) {
  .preview-toolbar { padding-inline: 15px; }
  .preview-document { padding-inline: 18px; }
  .preview-title h3 { font-size: 16px; }
  .preview-members small { display: none; }
  .preview-diff-line { font-size: 11px; padding-inline: 8px; gap: 7px; }
  .preview-diff-summary small { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .preview-sheet, .preview-window, .preview-annotation { transform: none; transition: none; }
}
</style>
