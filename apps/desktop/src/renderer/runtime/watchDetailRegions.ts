import { WATCH_DETAIL_MAX_SIDE } from '../../shared/watchTogether'

interface Region {
  x: number
  y: number
  width: number
  height: number
}

/** Rank overlapping source crops by short contrast edges, then keep a separate area in view. */
export function watchDetailRegions(
  probe: ImageData,
  sourceWidth: number,
  sourceHeight: number,
): Region[] {
  const width = Math.min(sourceWidth, WATCH_DETAIL_MAX_SIDE)
  const height = Math.min(sourceHeight, 640)
  if (width === sourceWidth && height === sourceHeight) return [{ x: 0, y: 0, width, height }]

  const { data, width: columns, height: rows } = probe
  const stride = columns + 1
  const edges = new Uint32Array(stride * (rows + 1))
  const luminance = (index: number) =>
    (data[index] * 54 + data[index + 1] * 183 + data[index + 2] * 19) >> 8
  for (let y = 1; y < rows - 1; y++) {
    let row = 0
    for (let x = 1; x < columns - 1; x++) {
      const index = (y * columns + x) * 4
      const center = luminance(index)
      const left = center - luminance(index - 4)
      const right = center - luminance(index + 4)
      const above = center - luminance(index - columns * 4)
      const below = center - luminance(index + columns * 4)
      // Narrow bright or dark strokes contribute more than a single object edge.
      if (left * right > 24 * 24 || above * below > 24 * 24) row++
      edges[y * stride + x] = edges[(y - 1) * stride + x] + row
    }
  }

  const candidates: (Region & { score: number })[] = []
  // Prefer the center on a flat image. Compare all positions when there is usable texture.
  for (const y of new Set(
    [0.5, 1, 0, 0.75, 0.25].map((p) => Math.round(p * (sourceHeight - height))),
  )) {
    for (const x of new Set(
      [0.5, 0, 1, 0.25, 0.75].map((p) => Math.round(p * (sourceWidth - width))),
    )) {
      const left = Math.round((x / sourceWidth) * (columns - 2))
      const right = Math.round(((x + width) / sourceWidth) * (columns - 2))
      const top = Math.round((y / sourceHeight) * (rows - 2))
      const bottom = Math.round(((y + height) / sourceHeight) * (rows - 2))
      const score =
        edges[bottom * stride + right] -
        edges[top * stride + right] -
        edges[bottom * stride + left] +
        edges[top * stride + left]
      candidates.push({ x, y, width, height, score })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  const next = candidates.find(
    ({ x, y }) =>
      Math.max(0, width - Math.abs(x - best.x)) * Math.max(0, height - Math.abs(y - best.y)) <
      width * height * 0.42,
  )
  return next ? [best, next] : [best]
}
