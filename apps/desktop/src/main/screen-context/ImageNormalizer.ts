import { type NativeImage, nativeImage } from 'electron'
import sharp from 'sharp'

import {
  SCREEN_CONTEXT_IMPORT_LIMITS,
  type ScreenContextImageMimeType,
  type ScreenContextImportMimeType,
} from '../../shared/screen-context'

const MAX_IMAGE_SIDE = 2048
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024
const PREVIEW_MAX_SIDE = 320
const PREVIEW_QUALITY = 72
const INITIAL_JPEG_QUALITY = 82

export interface NormalizedScreenContextImage {
  bytes: Uint8Array
  mimeType: ScreenContextImageMimeType
  width: number
  height: number
  previewDataUrl: string
}

export class ImageNormalizationError extends Error {
  constructor(
    readonly code:
      | 'CAPTURE_EMPTY'
      | 'CAPTURE_TOO_LARGE'
      | 'UNSUPPORTED_IMAGE_TYPE'
      | 'IMAGE_DECODE_FAILED',
  ) {
    super(code)
    this.name = 'ImageNormalizationError'
  }
}

function resizedWithinMaximum(image: NativeImage): NativeImage {
  const size = image.getSize()
  const largestSide = Math.max(size.width, size.height)
  if (largestSide <= MAX_IMAGE_SIDE) return image
  const scale = MAX_IMAGE_SIDE / largestSide
  return image.resize({
    width: Math.max(1, Math.floor(size.width * scale)),
    height: Math.max(1, Math.floor(size.height * scale)),
    quality: 'good',
  })
}

function previewDataUrl(image: NativeImage): string {
  const size = image.getSize()
  const largestSide = Math.max(size.width, size.height)
  const preview =
    largestSide > PREVIEW_MAX_SIDE
      ? image.resize({
          width: Math.max(1, Math.floor(size.width * (PREVIEW_MAX_SIDE / largestSide))),
          height: Math.max(1, Math.floor(size.height * (PREVIEW_MAX_SIDE / largestSide))),
          quality: 'good',
        })
      : image
  return `data:image/jpeg;base64,${preview.toJPEG(PREVIEW_QUALITY).toString('base64')}`
}

function encodeJpegWithinLimit(image: NativeImage): {
  bytes: Uint8Array
  image: NativeImage
} {
  let current = image
  let quality = INITIAL_JPEG_QUALITY
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const encoded = current.toJPEG(quality)
    if (encoded.byteLength > 0 && encoded.byteLength <= MAX_OUTPUT_BYTES) {
      return { bytes: new Uint8Array(encoded), image: current }
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
  throw new ImageNormalizationError('CAPTURE_TOO_LARGE')
}

function encodePngWithinLimit(image: NativeImage): {
  bytes: Uint8Array
  image: NativeImage
} {
  let current = image
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const encoded = current.toPNG()
    if (encoded.byteLength > 0 && encoded.byteLength <= MAX_OUTPUT_BYTES) {
      return { bytes: new Uint8Array(encoded), image: current }
    }
    const size = current.getSize()
    const width = Math.max(1, Math.floor(size.width * 0.8))
    const height = Math.max(1, Math.floor(size.height * 0.8))
    if (width === size.width && height === size.height) break
    current = current.resize({ width, height, quality: 'good' })
  }
  throw new ImageNormalizationError('CAPTURE_TOO_LARGE')
}

function hasExpectedSignature(bytes: Uint8Array, mimeType: ScreenContextImportMimeType): boolean {
  if (mimeType === 'image/png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    return signature.every((value, index) => bytes[index] === value)
  }
  if (mimeType === 'image/webp') {
    return (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    )
  }
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

function validateDecodedImage(image: NativeImage): void {
  const size = image.getSize()
  if (image.isEmpty() || size.width <= 0 || size.height <= 0) {
    throw new ImageNormalizationError('IMAGE_DECODE_FAILED')
  }
}

function normalizedResult(
  encoded: { bytes: Uint8Array; image: NativeImage },
  mimeType: ScreenContextImageMimeType,
): NormalizedScreenContextImage {
  if (encoded.bytes.byteLength === 0) throw new ImageNormalizationError('CAPTURE_EMPTY')
  if (encoded.bytes.byteLength > MAX_OUTPUT_BYTES) {
    throw new ImageNormalizationError('CAPTURE_TOO_LARGE')
  }
  const size = encoded.image.getSize()
  return {
    bytes: encoded.bytes,
    mimeType,
    width: size.width,
    height: size.height,
    previewDataUrl: previewDataUrl(encoded.image),
  }
}

export class ImageNormalizer {
  normalizeDesktopCapture(image: NativeImage): NormalizedScreenContextImage {
    if (image.isEmpty()) throw new ImageNormalizationError('CAPTURE_EMPTY')
    const resized = resizedWithinMaximum(image)
    return normalizedResult(encodeJpegWithinLimit(resized), 'image/jpeg')
  }

  async normalizeImport(
    bytes: ArrayBuffer,
    mimeType: ScreenContextImportMimeType,
  ): Promise<NormalizedScreenContextImage> {
    if (bytes.byteLength === 0) throw new ImageNormalizationError('CAPTURE_EMPTY')
    if (bytes.byteLength > SCREEN_CONTEXT_IMPORT_LIMITS.maxInputBytes) {
      throw new ImageNormalizationError('CAPTURE_TOO_LARGE')
    }
    if (mimeType !== 'image/jpeg' && mimeType !== 'image/png' && mimeType !== 'image/webp') {
      throw new ImageNormalizationError('UNSUPPORTED_IMAGE_TYPE')
    }
    const input = new Uint8Array(bytes)
    if (!hasExpectedSignature(input, mimeType)) {
      throw new ImageNormalizationError('IMAGE_DECODE_FAILED')
    }
    const decoded =
      mimeType === 'image/webp'
        ? await this.decodeWebp(input)
        : nativeImage.createFromBuffer(Buffer.from(input))
    validateDecodedImage(decoded)
    const resized = resizedWithinMaximum(decoded)
    const encoded =
      mimeType === 'image/jpeg' ? encodeJpegWithinLimit(resized) : encodePngWithinLimit(resized)
    return normalizedResult(encoded, mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png')
  }

  private async decodeWebp(bytes: Uint8Array): Promise<NativeImage> {
    try {
      const png = await sharp(Buffer.from(bytes), {
        animated: false,
        limitInputPixels: 64 * 1024 * 1024,
      })
        .rotate()
        .resize({
          width: MAX_IMAGE_SIDE,
          height: MAX_IMAGE_SIDE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png()
        .toBuffer()
      const decoded = nativeImage.createFromBuffer(png)
      validateDecodedImage(decoded)
      return decoded
    } catch {
      throw new ImageNormalizationError('IMAGE_DECODE_FAILED')
    }
  }
}
