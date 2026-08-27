import sharp from 'sharp'

// A 6 x 5 grayscale grid produces a bounded 30-byte structural fingerprint.
// A decision is stale when the mean normalized tile difference exceeds 1%.
// Downsampling plus disabled animations/hidden caret absorbs local anti-aliasing,
// a caret, and small animation noise while detecting a materially changed canvas.
const HASH_WIDTH = 6
const HASH_HEIGHT = 5
export const VISUAL_FINGERPRINT_STALE_TOLERANCE = 0.01

export async function createVisualFingerprint(image: Uint8Array): Promise<string> {
  const pixels = await sharp(image)
    .resize(HASH_WIDTH, HASH_HEIGHT, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer()
  return [...pixels].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export function visualFingerprintChanged(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) return true
  let totalDifference = 0
  for (let index = 0; index < expected.length; index += 2) {
    const left = Number.parseInt(expected.slice(index, index + 2), 16)
    const right = Number.parseInt(actual.slice(index, index + 2), 16)
    totalDifference += Math.abs(left - right)
  }
  return totalDifference / ((expected.length / 2) * 255) > VISUAL_FINGERPRINT_STALE_TOLERANCE
}
