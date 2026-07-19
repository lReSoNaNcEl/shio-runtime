import { type DesktopCapturerSource, desktopCapturer, type NativeImage } from 'electron'

import type {
  ScreenContextDesktopSourceKind,
  ScreenContextSource,
} from '../../shared/screen-context'

const PREVIEW_SIZE = { width: 320, height: 180 } as const
const CAPTURE_SIZE = { width: 2048, height: 2048 } as const

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

function sourceKind(source: DesktopCapturerSource): ScreenContextDesktopSourceKind {
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
    image: NativeImage
    sourceName: string
    sourceKind: ScreenContextDesktopSourceKind
  }> {
    const sources = await getSources(CAPTURE_SIZE, false)
    const source = sources.find((candidate) => candidate.id === sourceId)
    if (!source) throw new ScreenCaptureError('SOURCE_NOT_FOUND')
    if (source.thumbnail.isEmpty()) throw new ScreenCaptureError('CAPTURE_EMPTY')

    return {
      image: source.thumbnail,
      sourceName: source.name,
      sourceKind: sourceKind(source),
    }
  }
}
