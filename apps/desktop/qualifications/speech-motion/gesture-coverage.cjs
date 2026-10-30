// Visible conversational gesture coverage from a conversation-primary.json trace.
// Usage: node gesture-coverage.cjs <artifact directory or conversation-primary.json>
// Hand excursion is measured relative to the hips against the idle rest pose.
const fs = require('node:fs')
const path = require('node:path')

const VISIBLE_M = 0.08
const PROMINENCE_M = 0.04
// M3 groups delivery emotions by expected tempo; M4 tolerance; M7 visible idle action.
const ENERGETIC = new Set(['excited', 'happy', 'laugh', 'chuckle', 'angry', 'surprised', 'gasp'])
const CALM = new Set(['calm', 'sad', 'crying', 'sleepy', 'sigh', 'whisper', 'dazed'])
const ACCENT_TOLERANCE_MS = 120
const IDLE_ACTION_WINDOW_MS = 500
const IDLE_HAND_ACTION_M = 0.025
const IDLE_HEAD_ACTION_M = 0.015

const median = (values) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
const round = (value, digits = 3) => (value === null ? null : Number(value.toFixed(digits)))
const handOffset = (frame, side) =>
  frame.positions.length >= 15 ? (side === 'left' ? 6 : 9) : side === 'left' ? 3 : 6
const headOffset = (frame) => (frame.positions.length >= 15 ? 12 : 9)
const vector = (frame, offset) => [
  frame.positions[offset] - frame.positions[0],
  frame.positions[offset + 1] - frame.positions[1],
  frame.positions[offset + 2] - frame.positions[2],
]

/** Indices of prominence peaks: rest is the implicit starting minimum. */
function peakIndices(values, prominence = PROMINENCE_M) {
  const peaks = []
  let low = 0
  let high = values[0] ?? 0
  let highIndex = 0
  let rising = true
  for (const [index, value] of values.entries()) {
    if (rising) {
      if (value >= high) {
        high = value
        highIndex = index
      }
      if (high - value >= prominence && high - low >= prominence) {
        peaks.push(highIndex)
        rising = false
        low = value
      }
    } else {
      low = Math.min(low, value)
      if (value - low >= prominence) {
        rising = true
        high = value
        highIndex = index
      }
    }
  }
  return peaks
}

/** M2: median wrist height above the hips per audible delivery emotion (cm). */
function heightByEmotion(frames) {
  const groups = new Map()
  for (const frame of frames) {
    if (frame.pcm?.state !== 'playing' || !frame.deliveryEmotion) continue
    const height = Math.max(
      vector(frame, handOffset(frame, 'left'))[1],
      vector(frame, handOffset(frame, 'right'))[1],
    )
    if (!groups.has(frame.deliveryEmotion)) groups.set(frame.deliveryEmotion, [])
    groups.get(frame.deliveryEmotion).push(height)
  }
  return Object.fromEntries(
    [...groups].map(([emotion, values]) => [emotion, round(median(values) * 100, 1)]),
  )
}

/** M3: beat tempo (peaks per second of hand excursion) for energetic versus calm delivery. */
function tempoByGroup(frames, excursion) {
  const tempo = (filter) => {
    // Contiguous audible runs of one emotion group; a run ends at any other frame.
    const runs = []
    let run = []
    for (const frame of frames) {
      if (frame.pcm?.state === 'playing' && filter(frame.deliveryEmotion)) {
        run.push(frame)
        continue
      }
      if (run.length) runs.push(run)
      run = []
    }
    if (run.length) runs.push(run)
    let peaks = 0
    let seconds = 0
    for (const list of runs) {
      if (list.length < 2) continue
      peaks += peakIndices(list.map(excursion)).length
      seconds += (list.at(-1).at - list[0].at) / 1000
    }
    return seconds > 0 ? peaks / seconds : null
  }
  const energetic = tempo((emotion) => ENERGETIC.has(emotion))
  const calm = tempo((emotion) => CALM.has(emotion))
  return {
    energeticPerSecond: round(energetic),
    calmPerSecond: round(calm),
    ratio: energetic !== null && calm ? round(energetic / calm) : null,
  }
}

/** M4: share of beat endpoints (excursion peaks) within ±120 ms of a consumed speech accent. */
function accentAlignment(frames, excursion) {
  const speech = frames.filter((frame) => frame.pcm?.state === 'playing')
  const accents = new Map()
  for (const frame of speech)
    for (const sample of frame.accents ?? [])
      accents.set(`${frame.pcm.playbackId}:${sample}`, { playbackId: frame.pcm.playbackId, sample })
  const peaks = peakIndices(speech.map(excursion)).map((index) => speech[index])
  // Traces recorded before accent capture carry no accents: the share is unknown, not zero.
  if (peaks.length === 0 || accents.size === 0)
    return { beats: peaks.length, aligned: 0, share: null }
  let aligned = 0
  for (const frame of peaks) {
    const rate = frame.pcm.sourceSampleRate
    const tolerance = (ACCENT_TOLERANCE_MS * rate) / 1000
    for (const accent of accents.values())
      if (
        accent.playbackId === frame.pcm.playbackId &&
        Math.abs(accent.sample - frame.pcm.sourceSampleOffset) <= tolerance
      ) {
        aligned++
        break
      }
  }
  return { beats: peaks.length, aligned, share: round(aligned / peaks.length) }
}

/** M7: longest interval outside speech without a visible hand or head action. */
function longestQuiet(frames) {
  const idle = frames.filter((frame) => frame.pcm?.state !== 'playing')
  if (idle.length < 2) return { seconds: null, actions: 0 }
  let windowStart = 0
  let lastActionAt = idle[0].at
  let longest = 0
  let actions = 0
  for (let index = 1; index < idle.length; index++) {
    if (idle[index].at - idle[index - 1].at > 2_000) {
      // A speech turn or a capture gap separates idle stretches.
      longest = Math.max(longest, idle[index - 1].at - lastActionAt)
      lastActionAt = idle[index].at
      windowStart = index
      continue
    }
    while (idle[index].at - idle[windowStart].at > IDLE_ACTION_WINDOW_MS) windowStart++
    const from = idle[windowStart]
    const to = idle[index]
    const moved = (offset) =>
      Math.hypot(...vector(to, offset).map((value, axis) => value - vector(from, offset)[axis]))
    if (
      moved(handOffset(to, 'left')) >= IDLE_HAND_ACTION_M ||
      moved(handOffset(to, 'right')) >= IDLE_HAND_ACTION_M ||
      moved(headOffset(to)) >= IDLE_HEAD_ACTION_M
    ) {
      longest = Math.max(longest, to.at - lastActionAt)
      if (to.at - lastActionAt > IDLE_ACTION_WINDOW_MS) actions++
      lastActionAt = to.at
    }
  }
  longest = Math.max(longest, idle.at(-1).at - lastActionAt)
  return { seconds: round(longest / 1000, 1), actions }
}

function analyse(trace) {
  const frames = trace.frames.filter((frame) => frame.positions?.every((v) => v !== null))
  if (frames.length === 0) throw new Error('Trace has no hand positions')
  const relative = (frame, side) => vector(frame, handOffset(frame, side))
  const speaking = (frame) => frame.pcm?.state === 'playing'
  const idle = frames.filter(
    (frame) => !speaking(frame) && String(frame.profile).startsWith('presence'),
  )
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
    liveliness: {
      wristHeightByEmotionCm: heightByEmotion(frames),
      beatTempo: tempoByGroup(frames, excursion),
      accentAlignment: accentAlignment(frames, excursion),
      longestQuiet: longestQuiet(frames),
    },
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

module.exports = {
  accentAlignment,
  analyse,
  heightByEmotion,
  longestQuiet,
  peakIndices,
  tempoByGroup,
}
