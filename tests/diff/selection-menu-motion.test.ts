// @vitest-environment happy-dom

import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { useSelectionMenuMotion } from '../../app/components/editor/use-selection-menu-motion'

interface MotionControls {
  prepareEntrance: () => void
  playEntrance: () => void
  playExit: () => void
}

const mountedWrappers: ReturnType<typeof mount>[] = []

function mountMotionHarness() {
  const Harness = defineComponent({
    setup(_, { expose }) {
      const itemsRoot = ref<HTMLElement | null>(null)
      const motion = useSelectionMenuMotion(itemsRoot)
      expose(motion)

      return () =>
        h('div', { class: 'requirement-editor__selection-menu' }, [
          h(
            'div',
            { ref: itemsRoot, class: 'requirement-editor__selection-menu-items' },
            Array.from({ length: 5 }, (_, index) =>
              h('button', {
                class: 'requirement-editor__selection-tool',
                'aria-label': `工具 ${index + 1}`,
              }),
            ),
          ),
        ])
    },
  })

  const wrapper = mount(Harness, { attachTo: document.body })
  mountedWrappers.push(wrapper)
  const menu = wrapper.element as HTMLElement
  menu.getBoundingClientRect = () =>
    ({
      left: 120,
      top: 80,
      right: 320,
      bottom: 120,
      width: 200,
      height: 40,
      x: 120,
      y: 80,
      toJSON: () => ({}),
    }) as DOMRect

  return {
    menu,
    motion: wrapper.vm as unknown as MotionControls,
  }
}

afterEach(() => {
  mountedWrappers.splice(0).forEach(wrapper => wrapper.unmount())
  document.body.replaceChildren()
})

describe('selection menu stagger motion', () => {
  it('keeps every tool transform-free during the staggered entrance', async () => {
    const { menu, motion } = mountMotionHarness()

    motion.prepareEntrance()

    const tools = Array.from(menu.querySelectorAll<HTMLElement>('.requirement-editor__selection-tool'))
    expect(menu.classList.contains('requirement-editor__selection-menu--animating')).toBe(true)
    expect(menu.style.opacity).toBe('0')
    expect(menu.style.transform).toBe('')
    expect(tools).toSatisfy(items => items.every(tool => tool.style.opacity === '0'))
    expect(tools).toSatisfy(items => items.every(tool => tool.style.transform === ''))
    expect(tools).toSatisfy(items => items.every(tool => tool.style.transformOrigin === ''))

    motion.playEntrance()
    expect(tools).toSatisfy(items => items.every(tool => tool.style.transform === ''))
    expect(tools).toSatisfy(items => items.every(tool => tool.style.transformOrigin === ''))

    await new Promise(resolve => window.setTimeout(resolve, 240))
    expect(tools).toSatisfy(items => items.every(tool => tool.style.transform === ''))
    expect(tools).toSatisfy(items => items.every(tool => tool.style.transformOrigin === ''))
  })

  it('creates a non-interactive exit copy and removes it after the exit motion', async () => {
    const { motion } = mountMotionHarness()

    motion.prepareEntrance()
    motion.playEntrance()
    await new Promise(resolve => window.setTimeout(resolve, 240))
    motion.playExit()

    const clone = document.querySelector<HTMLElement>('.requirement-editor__selection-menu--exit-clone')
    expect(clone).not.toBeNull()
    expect(clone?.getAttribute('aria-hidden')).toBe('true')
    expect(clone?.style.pointerEvents).toBe('none')
    expect(clone?.style.transform).toBe('none')
    expect(clone?.style.transformOrigin).toBe('')
    expect(clone?.querySelector('button')?.getAttribute('tabindex')).toBe('-1')

    const cloneTools = Array.from(
      clone?.querySelectorAll<HTMLElement>('.requirement-editor__selection-tool') ?? [],
    )
    expect(cloneTools).toSatisfy(items => items.every(tool => tool.style.transform === ''))

    await new Promise(resolve => window.setTimeout(resolve, 60))
    expect(clone.style.transform).toBe('none')
    expect(cloneTools).toSatisfy(items => items.every(tool => tool.style.transform === ''))

    await new Promise(resolve => window.setTimeout(resolve, 120))
    expect(document.querySelector('.requirement-editor__selection-menu--exit-clone')).toBeNull()
  })
})
