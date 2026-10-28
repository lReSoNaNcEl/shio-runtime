# ARDY Online motion quality recovery — 28 October 2026

Baseline: `af5323d07836246e6d31ee3197826af4d6e29bb8`, branch
`codex/experiment-ardy-fish-s2-pro-v1`. Initial working tree was clean.

## Architecture review and implementation plan

Canonical decision: ARCHITECTURE.md, Avatar Runtime, “Consumed-motion resampling”.
Reviewed before implementation: body sampling/composition remains Avatar-owned;
AudioPlayer retains consumed PCM authority; Main retains one live ARDY Adapter;
Overlay retains presentation-only consumption. No camera, Speech API, model asset,
conditioning, semantic selection or authority changes are planned.

1. **RCA / qualification instrumentation.** Capture raw PCM offsets, actual body
   cursor, render intervals and joint stages during real conversation. Preserve
   a baseline recording and report derivative distortion using wall time as well
   as source time. This observes existing ownership without adding production IPC.
2. **Consumed-motion resampling.** Add one bounded Avatar-local sampler for the
   already consumed interval. Sample the complete body/hand phase from it and use
   its actual advancement for physical integration. Cover quantized reports,
   variable frame cadence, buffering, discontinuities and lifecycle invalidation.
3. **Trajectory fidelity.** Compare source, retarget, artistic constraints,
   admissibility and final composition on identical real GPU-generated horizons.
   Change another motion stage only if measurements identify a separate defect;
   retain anatomical/contact checks and expressive source timing/amplitude.
4. **GPU and visual qualification.** Rebuild an isolated Electron snapshot, run
   real Character + Fish + ARDY conversation with video/audio recording and fixed
   camera, inspect idle, speech, transitions, preview, LipSync, Overlay and health.
   Keep technical, readability and artistic acceptance separate. Run Desktop
   static checks, typecheck, focused regression and build before final reporting.

The plan is consistent with the canonical decision; implementation starts only
after this review. Generated horizons used for diagnostic comparison are not a
production clip library. Commit/push was outside the initial implementation scope;
the user's later publication instruction is recorded below.

## Evidence before implementation

The actual `AdaptiveMotionFilter` tracking a constant 0.2 rad/s target has speed
CV approximately zero with a continuous source clock. At 60 Hz composition and
512-sample/44.1 kHz reports it becomes 0.511; with 32 ms reports it becomes 0.967
and 58 of 120 measured frames do not move. At 120 Hz and 512-sample reports,
68 of 240 frames do not move. These are a deterministic reproduction of the
integration defect, not measurements of the model's artistic quality.

The baseline uses worklet reports every four output render quanta as both source
sampling time and filter integration duration. A repeated offset invokes `hold()`
and zeros velocity; the next report reaccelerates. Previous amplitude/safety and
semantic changes did not correct this timebase defect.

### WI3 consistency review

Fresh pinned RTX 5090 inference (seed 17, canonical conditioning) confirms a
second attenuation stage. For `explain_point_close` stroke, right lower-arm
amplitude falls from 0.142 rad after artistic constraints to 0.015 rad after
workspace projection; for `greet_wave_close`, 0.217 to 0.010 rad. The existing
workspace objective minimizes exact palm/finger alignment even inside their
admissible tolerances, with only 0.04 weight on source-relative displacement.
Candidate IK also starts from the preceding candidate's mutated configuration.

The alternative IK objective failed identical-source qualification: no consistent
wrist-excursion improvement and increased peak acceleration. It was reverted.
It is not part of the implementation. Joint amplitude alone is insufficient:
FK wrist excursion/travel was added to qualification to assess the actual gesture.

Canonical “Workspace displacement correction” is reviewed before the next
separate behavior Work Item. The fixed phase origin plus clamping accumulates
unrepresentable outward displacement. A source reversal can therefore leave the
hand pinned until that offset is repaid. Project incremental source displacement
with anti-windup at the unchanged boundary; retain declared physical/orientation
limits and phase-local reset. Re-run identical-source qualification and physical
regression before recording the final live candidate.

### Conversation readability recovery (user steering)

The actual configured view is Bust, 360 × 560, scale 1. Earlier recordings show
`explain`, `greeting` and `celebrate` disappearing from request-scoped semantic
availability while thinking/thanks remain. The compact alternatives are Face-only;
wide Bust workspaces sit close to the horizontal frustum edge. Concrete selection
also filters only camera policy, while execution applies the stricter spatial test.
That mismatch can choose a rejected profile even when another variant is feasible.

Canonical “Conversation gesture feasibility” reviewed before implementation:

1. Delegate exact profile feasibility from the existing body owner to semantic
   profile selection before intensity preference; retain Main's bounded semantic
   availability, renderer execution validation and existing expiry.
2. Retain the existing gesture set and ARDY conditioning. Qualify centred,
   source-relative workspaces for `greet_wave_soft`, `explain_one_palm` and
   `celebrate_petite` with the unchanged Bust camera. Bump the coordinated catalog
   revision, keep all physical/visibility acceptance thresholds.
3. Repeat ordinary real-LLM conversation and fixed-camera recording. A semantic
   intent, preparation-only movement, test fixture or green build is not a visible
   audible-stroke acceptance result.

The incremental workspace projection trial also failed the identical-source
excursion criterion and was reverted. Neither rejected spatial trial is shipped.

### Source-horizon fitting consistency review

The centred Bust source capture confirms the remaining boundary defect: the
greeting's artistic wrist stroke is 3.62 cm, final excursion 0.64 cm. A diagnostic
centred entry restores 7.39 cm, proving that entry placement, rather than model
failure, pins the stroke; a fixed centred entry is not shipped because it can add
unnecessary relocation. Incremental projection restores only 1.33 cm.

Canonical “Workspace trajectory fitting” is reviewed before implementation:
derive at most 60 future source hand displacements from the existing global
rotations and calibrated arm geometry; fit their envelope by nearest admissible
entry translation and uniform scale <= 1. Preserve source clock and all physical
checks. No stored movement, hand-authored stroke or second final writer is added.
Qualify on the same source capture before another live conversation recording.

### Idle vibration RCA and consistency review

The user's idle case is independent of PCM. Same-source stage analysis shows
that tiny constrained targets contain substantial velocity energy above 6 Hz;
direct source-velocity feed-forward transmits it through the presence tracker.
Removing only that feed-forward in a diagnostic replay reduces chest high-band
velocity energy 85.94 → 11.54 and lower-arm 67.23 → 4.50 (same units/window).
Lower-arm 95th-percentile acceleration falls 5.10 → 0.99 rad/s². Full slow-motion
excursion is retained. This is not a visual PASS by itself.

Canonical “Presence tracking correction” reviewed before implementation: change
only quiet-presence tracking in the one existing integrator; retain gesture and
reaction feed-forward, bounds, physical projection, procedural breathing and live
ARDY. Rebuild/restart the actual client so the user is not inspecting the old
process, then qualify idle independently of conversation.

## Publication checkpoint — user-requested current state

The user explicitly requested pushing the current implementation to origin after
being told that the full specification is not complete. This publication does
not claim artistic acceptance, a successful final-build recording or a release.

Implemented: bounded consumed-motion sampling, shared concrete-profile
feasibility, centred existing Bust gesture workspaces, source-horizon hand-envelope
fitting and the presence-only feed-forward correction. The resolver's
`isProfileAvailable` parameter placement error is fixed. Camera settings and
transforms, live ARDY/checkpoint/conditioning and Speech API ownership are retained.

Recorded evidence remains mixed:

- Real RTX 5090 source capture, pinned SOMA30, seed 17: fitted wrist stroke
  excursion increased from 0.64 to 2.45 cm for greeting and 0.59 to 1.86 cm for
  celebration, with zero unresolved arm contacts in that comparison.
- Live consumed body-cursor cadence CV fell from 0.340 to 0.009 in the measured
  steady playing/hold windows; this is cadence evidence, not an artistic score.
- Short real Character/Fish/ARDY run `joint-2026-10-28T08-26-46-724Z` passed all
  three selected readability cases: explanation 3.22 cm, greeting 12.42 cm,
  celebration 1.91 cm of audible-stroke excursion. The short run does not satisfy
  the existing 300-second overall technical criterion.
- The later full run `joint-2026-10-28T08-29-42-483Z` remains FAIL: explanation
  0.79 cm and an unperformed greeting preparation with
  `ARDY_SPATIAL_TARGET_UNREACHED`. Its successful other cases do not close this gap.
- The final presence-only correction postdates those recordings. The actual
  Desktop was rebuilt and restarted (PID 36364); the user stopped Computer Use
  with Escape before final visual confirmation. Do not label an earlier video as
  a fully qualified recording of that last correction.

Remaining: independent idle smoothness confirmation in Preview/Overlay, stable
audible gesture readability across generated variants and completed final-source
recording/visual acceptance. Local recordings and raw source artifacts remain
ignored and are not published to Git.

Pre-publication validation: Desktop Biome check/format/imports, TypeScript,
32-profile catalog/emotion synchronization and production build passed; fast
tests 211/211; complete Desktop regression 653/653 with `--maxWorkers=2`;
motion Python tests 46/46. The default-concurrency regression first reproduced
the unchanged Browser Control `planExpirations >= 1` timing failure; no Browser
source or expectation was changed. Biome retains three pre-existing informational
`useTemplate` notes in `qualifications/motion-ab/run.cjs`. Live qualification
limitations above remain in force despite these passing deterministic checks.
