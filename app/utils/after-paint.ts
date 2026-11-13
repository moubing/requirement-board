/** 给本次输入反馈一次绘制机会，再执行会大量改动 DOM 的视图切换。 */
export function afterNextPaint(run: () => void) {
  let frame = 0
  let timeout = 0
  let active = true
  const cancel = () => {
    active = false
    window.cancelAnimationFrame(frame)
    window.clearTimeout(timeout)
    document.removeEventListener('visibilitychange', visibilityChanged)
  }
  const finish = () => {
    if (!active) return
    cancel()
    run()
  }
  function visibilityChanged() { if (document.hidden) finish() }
  if (document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish()
  else {
    document.addEventListener('visibilitychange', visibilityChanged)
    frame = window.requestAnimationFrame(() => { frame = window.requestAnimationFrame(finish) })
    // 后台或浏览器暂停 rAF 时仍能完成导航；这不是等待动画播完。
    timeout = window.setTimeout(finish, 100)
  }
  return cancel
}
