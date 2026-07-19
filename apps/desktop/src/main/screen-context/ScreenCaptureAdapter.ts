import { type DesktopCapturerSource, desktopCapturer, type NativeImage } from 'electron'

import type { ScreenContextSource, ScreenContextSourceKind } from '../../shared/screen-context'

const PREVIEW_SIZE = { width: 320, height: 180 } as const
const CAPTURE_SIZE = { width: 2048, height: 2048 } as const
const INITIAL_JPEG_QUALITY = 82
const MAX_CAPTURE_BYTES = 5 * 1024 * 1024

export class ScreenCaptureError extends Error {
  constructor(
    readonly code:
      | 'PERMISSION_DENIED'
      | 'NO_SOURCES'
      | 'SOURCE_NOT_FOUND'
      | 'CAPTURE_EMPTY'
      | 'CAPTURE_TOO_LARGE'
      | 'UNKNOWN',
  ) {
    super(code)
    this.name = 'ScreenCaptureError'
  }
}

function sourceKind(source: DesktopCapturerSource): ScreenContextSourceKind {
  return source.id.startsWith('screen:') ? 'screen' : 'window'
}

function jpegDataUrl(image: NativeImage, quality: number): string {
  return `data:image/jpeg;base64,${image.toJPEG(quality).toString('base64')}`
}

function permissionDenied(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /permission|not authorized|denied/i.test(message)
}

async function getSources(
  thumbnailSize: Electron.Size,
  fetchWindowIcons: boolean,
): Promise<DesktopCapturerSource[]> {
  try {
    return await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize,
      fetchWindowIcons,
    })
  } catch (error) {
    throw new ScreenCaptureError(permissionDenied(error) ? 'PERMISSION_DENIED' : 'UNKNOWN')
  }
}

function encodeWithinLimit(image: NativeImage): {
  bytes: Uint8Array
  image: NativeImage
} {
  let current = image
  let quality = INITIAL_JPEG_QUALITY
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const jpeg = current.toJPEG(quality)
    if (jpeg.byteLength > 0 && jpeg.byteLength <= MAX_CAPTURE_BYTES) {
      return { bytes: new Uint8Array(jpeg), image: current }
    }
    if (quality > 52) {
      quality -= 10
      continue
    }
    const size = current.getSize()
    const width = Math.max(1, Math.floor(size.width * 0.8))
    const height = Math.max(1, Math.floor(size.height * 0.8))
    if (width === size.width && height === size.height) break
    current = current.resize({ width, height, quality: 'good' })
    quality = 72
  }
  throw new ScreenCaptureError('CAPTURE_TOO_LARGE')
}

export class ScreenCaptureAdapter {
  async listSources(): Promise<ScreenContextSource[]> {
    const sources = await getSources(PREVIEW_SIZE, true)
    const result = sources.flatMap((source): ScreenContextSource[] => {
      if (source.thumbnail.isEmpty()) return []
      const kind = sourceKind(source)
      return [
        {
          id: source.id,
          name: source.name,
          kind,
          previewDataUrl: jpegDataUrl(source.thumbnail, 72),
          appIconDataUrl:
            kind === 'window' && source.appIcon && !source.appIcon.isEmpty()
              ? source.appIcon.toDataURL()
              : undefined,
        },
      ]
    })
    if (result.length === 0) throw new ScreenCaptureError('NO_SOURCES')
    return result
  }

  async captureSource(sourceId: string): Promise<{
    bytes: Uint8Array
    mimeType: 'image/jpeg'
    sourceName: string
    sourceKind: ScreenContextSourceKind
    width: number
    height: number
    previewDataUrl: string
  }> {
    const sources = await getSources(CAPTURE_SIZE, false)
    const source = sources.find((candidate) => candidate.id === sourceId)
    if (!source) throw new ScreenCaptureError('SOURCE_NOT_FOUND')
    if (source.thumbnail.isEmpty()) throw new ScreenCaptureError('CAPTURE_EMPTY')

    const encoded = encodeWithinLimit(source.thumbnail)
    const size = encoded.image.getSize()
    const preview = encoded.image.resize({
      width: PREVIEW_SIZE.width,
      quality: 'good',
    })
    return {
      bytes: encoded.bytes,
      mimeType: 'image/jpeg',
      sourceName: source.name,
      sourceKind: sourceKind(source),
      width: size.width,
      height: size.height,
      previewDataUrl: jpegDataUrl(preview, 72),
    }
  }
}
