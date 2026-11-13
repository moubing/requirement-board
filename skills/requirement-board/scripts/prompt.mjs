import { emitKeypressEvents } from 'node:readline'

export class SetupCancelled extends Error {
  constructor() { super('已取消操作，未更改安装与配置。') }
}

/** 凭证只从交互终端读取，不接受命令参数或会被终端回显的管道输入。 */
export function prompt(message, { hidden = false, defaultValue = '', input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY || !input.setRawMode) throw new Error('请在交互式终端运行安装向导。')
  const wasFlowing = input.readableFlowing === true
  emitKeypressEvents(input)
  const wasRaw = Boolean(input.isRaw)
  input.setRawMode(true)
  output.write(`${message}${defaultValue && !hidden ? ` (${defaultValue})` : ''}：`)
  return new Promise((resolve, reject) => {
    let value = ''
    function finish(error) {
      input.off('keypress', onKeypress)
      input.off('end', onEnd)
      input.setRawMode(wasRaw)
      if (!wasFlowing) input.pause()
      output.write('\n')
      if (error) reject(error)
      else resolve(value || defaultValue)
    }
    const onEnd = () => finish(new SetupCancelled())
    function onKeypress(text, key = {}) {
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) return finish(new SetupCancelled())
      if (key.name === 'return' || key.name === 'enter') return finish()
      if (key.name === 'backspace') {
        if (value) { value = value.slice(0, -1); output.write('\b \b') }
        return
      }
      if (key.ctrl || key.meta || !text || /[\u0000-\u001f\u007f]/.test(text)) return
      value += text
      output.write(hidden ? '*'.repeat(Array.from(text).length) : text)
    }
    input.on('keypress', onKeypress)
    input.once('end', onEnd)
    input.resume()
  })
}
