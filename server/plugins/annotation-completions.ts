import { useDatabase } from '../db/client'
import { expireAnnotationCompletions } from '../services/annotation-completions'

export default defineNitroPlugin(app => {
  let running: Promise<void> | undefined
  const sweep = () => {
    if (running) return
    running = Promise.resolve().then(() => expireAnnotationCompletions(useDatabase()))
      .catch(error => { console.error('清理过期的 AI 标注完成信息失败，下次定时清理会重试。', error) })
      .finally(() => { running = undefined })
  }
  const timer = setInterval(sweep, 60 * 60 * 1000)
  timer.unref()
  sweep()
  app.hooks.hook('close', async () => { clearInterval(timer); await running })
})
