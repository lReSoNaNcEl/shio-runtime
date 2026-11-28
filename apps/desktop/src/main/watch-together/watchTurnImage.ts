import sharp from 'sharp'

import {
  WATCH_TURN_MAX_BYTES,
  WATCH_TURN_MAX_PIXELS,
  WATCH_TURN_MAX_SIDE,
} from '../../shared/watchTogether'

export interface WatchTurnImage {
  frame: Uint8Array
  frameTiles?: { columns: number; images: Uint8Array[] }
}

const tileSide = 1600
const tileOverlap = 64
const maxCombinedBytes = 4 * 1024 * 1024

function splitAxis(length: number) {
  const count = Math.max(1, Math.ceil((length - tileOverlap) / (tileSide - tileOverlap)))
  return Array.from({ length: count }, (_, i) => {
    const start = Math.max(0, Math.floor((i * length) / count) - tileOverlap / 2)
    const end = Math.min(length, Math.floor(((i + 1) * length) / count) + tileOverlap / 2)
    return { start, length: end - start }
  })
}

/** One direct-turn image. No crops are retained after the turn or supplied to background observation. */
export async function prepareWatchTurnImage(
  input: ArrayBuffer,
  current: () => boolean,
): Promise<WatchTurnImage | undefined> {
  if (input.byteLength < 100 || input.byteLength > WATCH_TURN_MAX_BYTES || !current()) return
  const frame = Buffer.from(input)
  const source = sharp(frame, { limitInputPixels: WATCH_TURN_MAX_PIXELS })
  const meta = await source.metadata()
  if (
    !current() ||
    meta.format !== 'jpeg' ||
    Math.max(meta.width, meta.height) > WATCH_TURN_MAX_SIDE ||
    meta.width * meta.height > WATCH_TURN_MAX_PIXELS
  )
    return
  if (Math.max(meta.width, meta.height) < 2000) return { frame }

  // Decode the bounded JPEG once. Each output encoder reads its rectangle from the same RGB buffer.
  const { data, info } = await source
    .autoOrient()
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (!current()) return
  const rgb = () =>
    sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
  const overview = await rgb()
    .resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer()
  const columns = splitAxis(info.width)
  const rows = splitAxis(info.height)
  let total = overview.byteLength
  const images: Uint8Array[] = []
  for (const y of rows) {
    for (const x of columns) {
      if (!current()) return
      const tile = await rgb()
        .extract({ left: x.start, top: y.start, width: x.length, height: y.length })
        .jpeg({ quality: 91, chromaSubsampling: '4:4:4' })
        .toBuffer()
      total += tile.byteLength
      if (total > maxCombinedBytes) return { frame }
      images.push(tile)
    }
  }
  return { frame: overview, frameTiles: { columns: columns.length, images } }
}
