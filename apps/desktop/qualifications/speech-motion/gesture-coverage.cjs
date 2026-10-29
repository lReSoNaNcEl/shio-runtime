// Visible conversational gesture coverage from a conversation-primary.json trace.
// Usage: node gesture-coverage.cjs <artifact directory or conversation-primary.json>
// Hand excursion is measured relative to the hips against the idle rest pose.
const fs = require('node:fs')
const path = require('node:path')

const VISIBLE_M = 0.08
const PROMINENCE_M = 0.04

function analyse(trace) {
  const frames = trace.frames.filter((frame) => frame.positions?.every((v) => v !== null))
  if (frames.length === 0) throw new Error('Trace has no hand positions')
  const relative = (frame, side) => {
    const p = frame.positions
    const offset = side === 'left' ? 3 : 6
    return [p[offset] - p[0], p[offset + 1] - p[1], p[offset + 2] - p[2]]
  }
  const speaking = (frame) => frame.pcm?.state === 'playing'
  const idle = frames.filter(
    (frame) => !speaking(frame) && String(frame.profile).startsWith('presence'),
  )
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }
  const reference = (idle.length > 30 ? idle : frames.slice(0, 30)).map((frame) => frame)
  const rest = Object.fromEntries(
    ['left', 'right'].map((side) => [
      side,
      [0, 1, 2].map((axis) => median(reference.map((frame) => relative(frame, side)[axis]))),
    ]),
  )
  const excursion = (frame) =>
    Math.max(
      ...['left', 'right'].map((side) =>
        Math.hypot(...relative(frame, side).map((v, i) => v - rest[side][i])),
      ),
    )
  const turns = new Map()
  for (const frame of frames) {
    if (!speaking(frame)) continue
    const id = frame.pcm.turnId
    if (!turns.has(id)) turns.set(id, [])
    turns.get(id).push(frame)
  }
  const results = []
  for (const [turnId, list] of turns) {
    const seconds = (list.at(-1).at - list[0].at) / 1000
    if (seconds < 3) continue
    const values = list.map(excursion)
    let visibleMs = 0
    let longestRestMs = 0
    let restMs = 0
    for (let index = 1; index < list.length; index++) {
      const dt = Math.min(200, list[index].at - list[index - 1].at)
      if (values[index] >= VISIBLE_M) {
        visibleMs += dt
        restMs = 0
      } else {
        restMs += dt
        longestRestMs = Math.max(longestRestMs, restMs)
      }
    }
    // Peaks of excursion with a bounded prominence approximate distinct strokes/beats.
    // Rest is the implicit starting minimum: a turn that opens mid-gesture counts it.
    let peaks = 0
    let low = 0
    let high = values[0]
    let rising = true
    for (const value of values) {
      if (rising) {
        high = Math.max(high, value)
        if (high - value >= PROMINENCE_M && high - low >= PROMINENCE_M) {
          peaks++
          rising = false
          low = value
        }
      } else {
        low = Math.min(low, value)
        if (value - low >= PROMINENCE_M) {
          rising = true
          high = value
        }
      }
    }
    results.push({
      turnId,
      seconds: Number(seconds.toFixed(1)),
      visibleShare: Number((visibleMs / (seconds * 1000)).toFixed(3)),
      longestRestSeconds: Number((longestRestMs / 1000).toFixed(1)),
      peaksPer15s: Number(((peaks * 15) / seconds).toFixed(1)),
      maxExcursionCm: Number((Math.max(...values) * 100).toFixed(1)),
      profiles: [...new Set(list.map((frame) => frame.profile))],
    })
  }
  const total = results.reduce((sum, item) => sum + item.seconds, 0)
  return {
    restReferenceFrames: reference.length,
    turns: results,
    aggregate: {
      speechSeconds: Number(total.toFixed(1)),
      visibleShare: Number(
        (results.reduce((sum, item) => sum + item.visibleShare * item.seconds, 0) / total).toFixed(
          3,
        ),
      ),
      worstRestSeconds: Math.max(...results.map((item) => item.longestRestSeconds)),
      peaksPer15s: Number(
        (results.reduce((sum, item) => sum + item.peaksPer15s * item.seconds, 0) / total).toFixed(
          1,
        ),
      ),
    },
  }
}

if (require.main === module) {
  const input = process.argv[2]
  const file = fs.statSync(input).isDirectory()
    ? path.join(input, 'conversation-primary.json')
    : input
  console.log(JSON.stringify(analyse(JSON.parse(fs.readFileSync(file, 'utf8'))), null, 2))
}

module.exports = { analyse }
