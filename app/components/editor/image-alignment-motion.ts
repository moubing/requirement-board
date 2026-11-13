type FlipPlugin = typeof import('gsap/Flip')['Flip']
type FlipState = ReturnType<FlipPlugin['getState']>

interface ImageAlignmentMotionOptions {
  onFrame: () => void
  onFinish: () => void
}

export function startImageAlignmentMotion(
  Flip: FlipPlugin,
  state: FlipState,
  options: ImageAlignmentMotionOptions,
) {
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    options.onFinish()
    options.onFrame()
  }

  return Flip.from(state, {
    duration: 0.34,
    ease: 'power2.inOut',
    nested: true,
    prune: true,
    scale: false,
    overwrite: true,
    onUpdate: options.onFrame,
    onComplete: finish,
    onInterrupt: finish,
  })
}
