import type { ScreenContextImportMimeType } from '../../../shared/screen-context'

export function isSupportedImageMimeType(type: string): type is ScreenContextImportMimeType {
  return type === 'image/png' || type === 'image/jpeg' || type === 'image/webp'
}

export function isSupportedImageFile(
  file: File,
): file is File & { type: ScreenContextImportMimeType } {
  if (!isSupportedImageMimeType(file.type)) return false
  return /\.(?:jpe?g|png|webp)$/iu.test(file.name)
}

function filesFromItems(data: DataTransfer): File[] {
  return Array.from(data.items).flatMap((item): File[] => {
    if (item.kind !== 'file') return []
    const entry = item.webkitGetAsEntry?.()
    if (entry?.isDirectory) return []
    const file = item.getAsFile()
    return file ? [file] : []
  })
}

export function clipboardImageFiles(data: DataTransfer): File[] {
  return filesFromItems(data).filter(isSupportedImageFile)
}

export function droppedImageFiles(data: DataTransfer): File[] {
  return filesFromItems(data).filter(isSupportedImageFile)
}
