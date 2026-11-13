function imagePng(image: HTMLImageElement) {
  return new Promise<Blob>((resolve, reject) => {
    const canvas = image.ownerDocument.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法读取图片')
    context.drawImage(image, 0, 0)
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('无法读取图片'))
    }, 'image/png')
  })
}

export async function copyImageToClipboard(image: HTMLImageElement | null) {
  if (typeof ClipboardItem === 'undefined' || typeof navigator.clipboard?.write !== 'function') {
    throw new Error('当前浏览器不支持复制图片，请使用 HTTPS 或本机 localhost 页面重试。')
  }
  if (!image?.complete || !image.naturalWidth || !image.naturalHeight) {
    throw new Error('图片尚未加载完成，请稍后重试。')
  }

  const png = imagePng(image)
  // 写入被拒绝时，浏览器可能不会消费图片 Promise，仍需处理转换失败。
  void png.catch(() => undefined)
  try {
    // 在点击事件内立即发起写入，异步编码交给 ClipboardItem，保留用户激活状态。
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
  } catch (error) {
    if (error instanceof Error && error.name === 'NotAllowedError') {
      throw new Error('请允许浏览器访问剪贴板后重试。')
    }
    throw new Error('无法复制这张图片，请确认图片可正常访问后重试。')
  }
}
