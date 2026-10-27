const assert = require('node:assert/strict')
const { SEMANTIC_EMBODIMENT_CASES } = require('./semantic-embodiment-cases.cjs')

const FIXED_SEEDS = Object.freeze([
  17, 101, 271, 503, 907, 1201, 1907, 2503, 4001, 6007, 8011, 10009,
])
const CAMERAS = Object.freeze(['full', 'bust', 'face', 'left-hand', 'right-hand'])
const PRESERVATION_CASES = Object.freeze([
  'ears-tail-springs-during-presence-and-gesture',
  'blink-speaking-eye-expression-lipsync-composition',
  'gaze-user-screen-camera-arbitration',
  'multi-packet-stream-with-audible-delivery-boundaries',
  'buffering-with-live-secondary-motion-and-spring-settling',
  'provider-complete-before-last-consumed-sample',
  'body-stop-speech-cancel-emergency-stop-with-late-callbacks',
  'model-replacement-with-and-without-optional-appendages',
  'preview-close-overlay-open-preview-reopen',
])

/** Planning data is never proof of qualification. Every case starts pending. */
function createStandingQualificationPlan(catalog, profileIds) {
  assert.equal(catalog.schemaVersion, 2, 'Standing qualification requires the phase contract')
  const profiles = profileIds
    ? profileIds.map((id) => {
        const profile = catalog.profiles.find((entry) => entry.id === id)
        assert(profile, 'Unknown qualification profile')
        return profile
      })
    : catalog.profiles
  assert.equal(new Set(profiles.map((entry) => entry.id)).size, profiles.length)
  return {
    catalogRevision: catalog.catalogRevision,
    status: 'pending',
    fixedSeedExecution: 'pending',
    rigVersions: ['VRM0', 'VRM1'],
    requiredCameras: CAMERAS,
    thresholds: {
      sourceFrameMs: 50,
      accentTimingToleranceMs: 50,
      plantedFootDriftHeightRatio: 0.01 / 1.65,
      transitionRootJumpHeightRatio: 0.01 / 1.65,
      transitionWristJumpHeightRatio: 0.02 / 1.65,
    },
    cases: profiles.flatMap((profile) =>
      FIXED_SEEDS.map((seed) => ({
        profileId: profile.id,
        seed,
        handScoreRevision: profile.handScore.revision,
        calibrationRevision: profile.handScore.calibrationRevision,
        phases: profile.phases.map((phase) => phase.id),
        status: 'pending',
        visualAcceptance: 'pending',
        poseMetrics: 'pending',
      })),
    ),
    transitionCases: [
      {
        profileIds: [
          'greet_wave_soft',
          'presence_listening',
          'explain_one_palm',
          'reassure_palm',
          'presence_poised',
        ],
        status: 'pending',
      },
      {
        profileIds: ['greet_wave_soft', 'thank_heart_hover', 'peace_single', 'presence_poised'],
        requiredRoute: 'bridge-or-recovery',
        status: 'pending',
      },
    ],
    semanticCases: SEMANTIC_EMBODIMENT_CASES.map((entry) => ({
      ...entry,
      qualificationStatus: 'pending',
      provider: null,
      model: null,
      observedIntent: null,
      semanticAcceptance: 'pending',
    })),
    preservationCases: PRESERVATION_CASES.map((id) => ({ id, status: 'pending' })),
    latency: { p50: null, p95: null, p99: null, jointFishLoad: 'pending' },
  }
}

module.exports = { FIXED_SEEDS, createStandingQualificationPlan }
