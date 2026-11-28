import sharp from 'sharp'

import { WATCH_FRAME_HEIGHT, WATCH_FRAME_WIDTH } from '../../shared/watchTogether'

/** Log-frequency spectrogram for vision models, synchronized with the sampled frames. */
export async function playbackEvidence(frames: Buffer, pcm: Int16Array): Promise<Buffer> {
  const columns = 96,
    bands = 48,
    windowSize = 256
  const pixels = Buffer.alloc(columns * bands)
  for (let band = 0; band < bands; band++) {
    const frequency = 80 * (7600 / 80) ** (band / (bands - 1))
    const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / 16000)
    for (let column = 0; column < columns; column++) {
      const offset = Math.floor(((pcm.length - windowSize) * column) / (columns - 1))
      let a = 0,
        b = 0
      for (let i = 0; i < windowSize; i++) {
        const next = (pcm[offset + i] / 32768) * hann[i] + coefficient * a - b
        b = a
        a = next
      }
      const power = Math.max(1e-12, (a * a + b * b - coefficient * a * b) / windowSize ** 2)
      pixels[(bands - 1 - band) * columns + column] = Math.round(
        255 * Math.max(0, Math.min(1, (10 * Math.log10(power) + 75) / 65)),
      )
    }
  }
  const spectrum = await sharp(pixels, { raw: { width: columns, height: bands, channels: 1 } })
    .resize(WATCH_FRAME_WIDTH * 2, 72, { fit: 'fill' })
    .png()
    .toBuffer()
  return sharp(frames, { limitInputPixels: WATCH_FRAME_WIDTH * 2 * WATCH_FRAME_HEIGHT })
    .extend({ bottom: 72, background: 'black' })
    .composite([{ input: spectrum, left: 0, top: WATCH_FRAME_HEIGHT }])
    .jpeg({ quality: 78 })
    .toBuffer()
}
const hann = Float32Array.from(
  { length: 256 },
  (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 255),
)
