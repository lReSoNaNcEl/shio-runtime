/** Numerical evidence is separate from visual readability. Preparation never qualifies a gesture. */
function assessGesture(execution, intent) {
  const arms = Object.entries(execution.joints).filter(([name]) => /UpperArm|LowerArm/u.test(name))
  const armExcursionDeg = Math.max(
    0,
    ...arms.map(([, value]) => (value.excursionRad * 180) / Math.PI),
  )
  const handTravelM = Math.max(
    0,
    ...Object.values(execution.hands).map((value) => value.excursionM),
  )
  const strokeHandTravelM = Math.max(
    0,
    ...Object.values(execution.hands).map((value) => value.strokeExcursionM),
  )
  const readableMinimum = intent === 'greeting' ? 0.06 : 0.035
  return {
    armExcursionDeg,
    handTravelM,
    strokeHandTravelM,
    passed:
      execution.strokeSamples >= 6 &&
      execution.strokeDurationMs >= 100 &&
      armExcursionDeg >= 5 &&
      handTravelM >= readableMinimum &&
      strokeHandTravelM >= 0.015,
    visualAcceptance: 'pending',
  }
}
module.exports = { assessGesture }
