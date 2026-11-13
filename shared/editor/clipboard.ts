interface ClipboardItemLike {
  kind: string
  type: string
  getAsFile: () => File | null
}

interface ClipboardDataLike {
  items?: ArrayLike<ClipboardItemLike>
  files?: ArrayLike<File>
}

export function extractClipboardImageFiles(clipboardData: ClipboardDataLike | null | undefined): File[] {
  if (!clipboardData) return []

  const itemImages = Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))

  if (itemImages.length) return itemImages
  return Array.from(clipboardData.files ?? []).filter((file) => file.type.startsWith('image/'))
}

export function clipboardImageFileName(file: File, index = 0) {
  if (file.name) return file.name

  const extension = file.type.split('/')[1]?.split('+')[0] || 'png'
  return `clipboard-image-${Date.now()}-${index + 1}.${extension}`
}
