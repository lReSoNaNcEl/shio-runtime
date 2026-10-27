import * as THREE from 'three'

/** Planar support geometry in world metres. No scene mutation or pose authority. */
export function supportHull(points: THREE.Vector2[]): THREE.Vector2[] {
  const sorted = points.map((p) => p.clone()).sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const half = (values: THREE.Vector2[]) => {
    const result: THREE.Vector2[] = []
    for (const p of values) {
      while (
        result.length > 1 &&
        cross(result[result.length - 2], result[result.length - 1], p) <= 0
      )
        result.pop()
      result.push(p)
    }
    return result.slice(0, -1)
  }
  return [...half(sorted), ...half(sorted.reverse())]
}

export function supportMargin(point: THREE.Vector2, polygon: readonly THREE.Vector2[]): number {
  let margin = Infinity
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index],
      b = polygon[(index + 1) % polygon.length]
    const dx = b.x - a.x,
      dy = b.y - a.y
    margin = Math.min(margin, (dx * (point.y - a.y) - dy * (point.x - a.x)) / Math.hypot(dx, dy))
  }
  return margin
}

export function closestSupportPoint(
  point: THREE.Vector2,
  polygon: readonly THREE.Vector2[],
  inset: number,
): THREE.Vector2 {
  const result = point.clone()
  // Projection onto a small convex intersection; bounded alternating halfplanes.
  for (let iteration = 0; iteration < 12; iteration++) {
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index],
        b = polygon[(index + 1) % polygon.length]
      const edge = b.clone().sub(a),
        normal = new THREE.Vector2(-edge.y, edge.x).normalize()
      const distance = result.clone().sub(a).dot(normal)
      if (distance < inset) result.addScaledVector(normal, inset - distance)
    }
  }
  return result
}

export function supportsOverlap(
  a: readonly THREE.Vector2[],
  b: readonly THREE.Vector2[],
  clearance: number,
): boolean {
  for (const polygon of [a, b]) {
    for (let index = 0; index < polygon.length; index++) {
      const edge = polygon[(index + 1) % polygon.length].clone().sub(polygon[index])
      const axis = new THREE.Vector2(-edge.y, edge.x).normalize()
      const aa = a.map((p) => p.dot(axis)),
        bb = b.map((p) => p.dot(axis))
      if (
        Math.max(...aa) + clearance < Math.min(...bb) ||
        Math.max(...bb) + clearance < Math.min(...aa)
      )
        return false
    }
  }
  return true
}
