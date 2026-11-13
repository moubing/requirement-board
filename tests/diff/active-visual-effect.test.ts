// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useActiveVisualEffect } from '../../app/composables/use-active-visual-effect'

describe('可暂停的视觉资源', () => {
  it('隐藏时不安装监听；反复激活保持单份资源，卸载完全释放', async () => {
    const active = ref(false), listener = vi.fn()
    let resources = 0
    const wrapper = mount(defineComponent({ setup() {
      useActiveVisualEffect(() => active.value, () => {
        resources++
        window.addEventListener('resize', listener)
        return () => { resources--; window.removeEventListener('resize', listener) }
      })
      return () => h('div')
    } }))
    expect(resources).toBe(0)
    for (let i = 0; i < 20; i++) {
      active.value = true; await nextTick()
      expect(resources).toBe(1)
      window.dispatchEvent(new Event('resize'))
      expect(listener).toHaveBeenCalledTimes(i + 1)
      active.value = false; await nextTick()
      expect(resources).toBe(0)
      window.dispatchEvent(new Event('resize'))
      expect(listener).toHaveBeenCalledTimes(i + 1)
    }
    active.value = true; await nextTick()
    wrapper.unmount()
    expect(resources).toBe(0)
  })
})
