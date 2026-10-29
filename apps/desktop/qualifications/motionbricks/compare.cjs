const assert = require('node:assert/strict')
const fs = require('node:fs')

const [beforeFile, afterFile] = process.argv.slice(2)
assert(beforeFile && afterFile, 'Supply identical-source before/after dynamics reports')
const before = JSON.parse(fs.readFileSync(beforeFile, 'utf8'))
const after = JSON.parse(fs.readFileSync(afterFile, 'utf8'))
assert.equal(before.sourceSha256, after.sourceSha256, 'Native source must be identical')
assert.equal(before.vrmSha256, after.vrmSha256, 'VRM must be identical')
const previous = before.cases.find((entry) => entry.profileId === 'explain_point_close')
const candidate = after.cases.find((entry) => entry.profileId === 'explain_point_close')
assert.deepEqual(previous.strokeRange, candidate.strokeRange, 'Consumed phase windows must match')
assert.equal(candidate.unresolvedArmContacts, 0, 'Collision safety remains authoritative')
const source = candidate.strokeWrists['artistic:right'].excursionM
const admitted = candidate.strokeWrists['admissible:right'].excursionM
const old = previous.strokeWrists['admissible:right'].excursionM
assert(
  admitted >= 0.015 && admitted > old * 2,
  'Preserve a real source stroke, not residual preparation',
)
assert(admitted <= source * 1.2, 'Do not qualify amplification as source preservation')
console.log(
  JSON.stringify({
    sourceSha256: after.sourceSha256,
    vrmSha256: after.vrmSha256,
    oldAdmittedM: old,
    admittedM: admitted,
    sourceM: source,
    contacts: candidate.unresolvedArmContacts,
    deterministicRegression: 'pass',
    artisticAcceptance: 'pending',
  }),
)
