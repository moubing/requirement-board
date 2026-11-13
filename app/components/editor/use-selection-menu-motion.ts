import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { gsap } from 'gsap'

interface MenuRect {
  left: number
  top: number
  width: number
  height: number
}

const TOOL_SELECTOR = '.requirement-editor__selection-tool'

export function useSelectionMenuMotion(itemsRoot: Ref<HTMLElement | null>) {
  let reduceMotion = false
  let entrancePending = false
  let lastMenuRect: MenuRect | null = null
  let exitClone: HTMLElement | null = null
  let motionPreference: ReturnType<typeof gsap.matchMedia> | null = null
  let entranceMenuTween: gsap.core.Tween | null = null
  let entranceItemsTween: gsap.core.Tween | null = null
  let exitMenuTween: gsap.core.Tween | null = null
  let exitItemsTween: gsap.core.Tween | null = null

  function getMenuElement() {
    return itemsRoot.value?.parentElement ?? null
  }

  function getTools(menu: HTMLElement) {
    return Array.from(menu.querySelectorAll<HTMLElement>(TOOL_SELECTOR))
  }

  function captureMenuRect(menu: HTMLElement) {
    const rect = menu.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    lastMenuRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    }
  }

  function killEntrance() {
    entranceMenuTween?.kill()
    entranceItemsTween?.kill()
    entranceMenuTween = null
    entranceItemsTween = null
  }

  function killExit() {
    exitMenuTween?.kill()
    exitItemsTween?.kill()
    exitMenuTween = null
    exitItemsTween = null
    exitClone?.remove()
    exitClone = null
  }

  function restoreMenu(menu: HTMLElement) {
    const tools = getTools(menu)
    menu.classList.remove('requirement-editor__selection-menu--animating')
    gsap.set(menu, { autoAlpha: 1, clearProps: 'transform,transformOrigin' })
    gsap.set(tools, { autoAlpha: 1, clearProps: 'transform,transformOrigin,opacity,visibility' })
  }

  function prepareEntrance() {
    const menu = getMenuElement()
    if (!menu) return

    killExit()
    killEntrance()
    entrancePending = !reduceMotion

    if (reduceMotion) {
      restoreMenu(menu)
      return
    }

    const tools = getTools(menu)
    menu.classList.add('requirement-editor__selection-menu--animating')
    // Floating UI positions the menu while it is hidden. Keep both the menu and
    // its tools transform-free so the first visible pixels cannot expand sideways.
    gsap.set(menu, {
      autoAlpha: 0,
    })
    gsap.set(tools, {
      autoAlpha: 0,
      clearProps: 'transform,transformOrigin',
    })
  }

  function playEntrance() {
    const menu = getMenuElement()
    if (!menu) return

    captureMenuRect(menu)
    if (!entrancePending || reduceMotion) return
    entrancePending = false

    const tools = getTools(menu)
    entranceMenuTween = gsap.to(menu, {
      autoAlpha: 1,
      duration: 0.16,
      ease: 'power2.out',
      overwrite: 'auto',
      onComplete: () => {
        entranceMenuTween = null
        captureMenuRect(menu)
      },
    })
    entranceItemsTween = gsap.to(tools, {
      autoAlpha: 1,
      duration: 0.12,
      ease: 'power2.out',
      stagger: { each: 0.018, from: 'start' },
      overwrite: 'auto',
      clearProps: 'opacity,visibility',
      onComplete: () => {
        entranceItemsTween = null
        menu.classList.remove('requirement-editor__selection-menu--animating')
      },
    })
  }

  function playExit() {
    entrancePending = false
    killEntrance()

    const menu = getMenuElement()
    const rect = lastMenuRect
    lastMenuRect = null
    if (!menu || !rect || reduceMotion) return

    killExit()
    const clone = menu.cloneNode(true) as HTMLElement
    clone.classList.add(
      'requirement-editor__selection-menu--animating',
      'requirement-editor__selection-menu--exit-clone',
    )
    clone.setAttribute('aria-hidden', 'true')
    clone.removeAttribute('aria-label')
    clone.removeAttribute('role')
    clone.removeAttribute('tabindex')
    clone.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'))
    clone.querySelectorAll<HTMLElement>('button, a, input, [tabindex]').forEach(element => {
      element.setAttribute('tabindex', '-1')
    })
    Object.assign(clone.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: '0',
      opacity: '1',
      visibility: 'visible',
      pointerEvents: 'none',
      transform: 'none',
    })
    document.body.append(clone)
    exitClone = clone

    const tools = getTools(clone)
    exitItemsTween = gsap.to(tools, {
      autoAlpha: 0,
      duration: 0.085,
      ease: 'power1.in',
      stagger: { each: 0.012, from: 'end' },
      overwrite: true,
    })
    exitMenuTween = gsap.to(clone, {
      autoAlpha: 0,
      duration: 0.13,
      ease: 'power1.in',
      overwrite: true,
      onComplete: () => {
        exitMenuTween = null
        exitItemsTween?.kill()
        exitItemsTween = null
        clone.remove()
        if (exitClone === clone) exitClone = null
      },
    })
  }

  onMounted(() => {
    motionPreference = gsap.matchMedia()
    motionPreference.add('(prefers-reduced-motion: reduce)', () => {
      reduceMotion = true
      entrancePending = false
      killEntrance()
      killExit()
      const menu = getMenuElement()
      if (menu) restoreMenu(menu)

      return () => {
        reduceMotion = false
      }
    })
  })

  onBeforeUnmount(() => {
    entrancePending = false
    killEntrance()
    killExit()
    motionPreference?.revert()
    motionPreference = null
  })

  return {
    prepareEntrance,
    playEntrance,
    playExit,
  }
}
