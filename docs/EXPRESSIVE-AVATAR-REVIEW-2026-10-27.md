# Expressive Avatar review after 1868536

## Architecture Review

Canonical decisions are recorded in ARCHITECTURE.md under Continuous expressive
embodiment review. Camera, Fish, release flow and draft turns remain outside changes.
Existing Avatar owners compose body, gaze, Blink, LipSync and facial contributions.

## Work Items

1. WI1 — reproduce audible underrun with first-error queue/request evidence and a
   deterministic delayed-provider regression. Correct the confirmed cause, retain
   bounded queues/deadlines, expiry, cancellation and live procedural presence.
2. WI2 — inspect expected lead-hand workspace against the unchanged camera before
   selection. Qualify readable compact execution or honestly decline an invisible
   hand act; never move the camera or warp a running pose.
3. WI3 — audit the actual VRM facial binds and usable deformation, compare 2D v22
   acting channels. Distinguish supported morphs, zero-effect morphs and missing rig.
4. WI4 — capability-gated temporal eye/brow/mouth acting within existing facial
   ownership, bilateral Blink where supported, no viseme or closure conflicts.
5. WI5 — real Chat/LLM/Fish/ARDY five-minute video with fixed camera and audio,
   separate technical and artistic results, including surprise, joy and idle.

WI4 includes a bounded amused/chuckle unilateral Blink event under the canonical
Expressive wink decision; bilateral support, existing Blink ownership, cooldown
and Overlay mirroring are mandatory before enabling it.

WI2 tangent-contact follow-up: seed17 real-rig preparation recorded a right-arm
ellipsoid metric0.9999805244, while left arm was clear. Sweep previously stopped
at exact zero clearance; the next breathing/attachment translation invalidated
that tangent by micrometres. Retain the existing3mm surface-sliding reserve in
the sweep, with bounded interpolation and unchanged zero-contact acceptance.
WI2 also qualifies an inset of the existing face workspace for compact palms:
the real stroke after the clearance correction could remain wrist-visible while
its little fingertip was cropped. A predeclared extent scale reduces that region,
shared by predictive selection and physical admission; no camera change or pose
screen clamp is permitted.
The inset-only candidate in joint-21-33 passed numerical checks but occluded the
eyes. It was rejected visually. The next candidate offsets the authored compact
workspace down and outward, in rig units, before trajectory admission.

## Evidence and status

Implementation and qualification are in progress. Historical first underrun in joint-19-18 occurred in
stroke near generatedEnd=272, cursor=271.5204, with another stroke in flight;
phaseAge=369 ms and last inference=186 ms. These values locate the gap but do not
alone prove why that request was scheduled or invalidated. The prior visual
qualification remains FAIL. No new artistic PASS is inferred from unit tests.

WI1 confirmed RCA: the ready-forecast cap held cursor at the prepare boundary while
physical target readiness lagged; clockBase retained consumed PCM debt. Promotion
then jumped ~30 source frames in live trace (216 → 246.22), resetting phase elapsed
time and leaving too little of its prepared stroke. A deterministic 2300ms spatial
preparation with a 500ms provider reproduced ARDY_AUDIBLE_UNDERRUN at stroke age400ms,
cursor79.8/end80, another stroke in flight — the historical failure's exact pattern.
Correct the clock origin where source time is actually capped; do not extend400ms.

## Model audit and 2D reference

The selected user VRM0 exposes16 expression groups and63 raw morph targets.
Its Joy group moves geometry by only1.586mm at maximum; no surprised expression
is registered. Increasing those preset weights cannot provide the missing acting.
The raw geometry, however, already contains all15 allowlisted acting channels:

| Acting channel | Measured maximum delta | Existing owner / 3D mapping |
| --- | --- | --- |
| browInnerUp |19.383mm| Mixer private expression bind |
| browDownLeft / Right |14.249mm| Independent brow lowering |
| browOuterUpLeft / Right |10.215mm| Independent outer-brow lift |
| eyeWideLeft / Right |2.563mm| Openness under Blink closure |
| eyeSquintLeft / Right |1.426mm| Emotional squint under Blink closure |
| mouthSmileLeft / Right |2.644mm| Mouth corners under LipSync/closure |
| mouthFrownLeft / Right |3.178mm| Mouth corners under LipSync/closure |
| mouthDimpleLeft / Right |1.753mm| Asymmetric smirk |

These are geometric capability measurements, not a claim of equal perceptual
strength or an artistic score. Attach-time inspection measures world-scaled
deformation and distinguishes supported, zero-effect and missing channels.
No model, geometry or skin weights were edited.

The reference branch is experiment/fish-s2-pro-shio-2d-v22 at8eebda2.
FacialProfile and LipSyncVariationController are already shared in behavior;
copying them would not add geometric controls. The 2D lidL/lidR reference maps to
the existing Blink controller's bilateral pair; brow/smile/asymmetry map to the
Mixer's capability-gated morph binds. Gaze/head remain with their existing owners.
Blush, tears and glints require a separately verified material/morph mechanism and
are not claimed here.25 semantic emotion IDs still resolve to11 facial profiles;
this work does not pretend that each ID is a unique authored facial performance.

## Implementation

- WI1: rebase capped body source time while consumed PCM advances; retain400ms
  stroke deadline and expiry. The permanent delayed-provider regression failed
  before the fix and passes afterward without skipping the prepared stroke.
- WI2: pass existing Overlay view metadata to Avatar selection; inspect calibrated
  lead/bilateral workspaces against a read-only projection of that fixed view.
  Overlay preset calculations are shared without changing their result.
  Three compact candidates are being qualified separately from wide gestures.
- WI3: audit above; a new Blender rig is unnecessary for the measured P0 channels.
- WI4: bounded temporal brow/eye/mouth contributions inside AvatarFacialRuntime,
  one final Mixer writer, raw semantic facial profiles retained rather than
  collapsed through the six-category body modulation. Acting variation uses
  consumed PCM during speech; Overlay receives the composed primary values.
  Blink remains the unilateral/bilateral eyelid owner, with a bounded expressive
  wink on entering chuckle/amused where bilateral expressions exist.
- WI5: pending final continuous300s real Chat qualification and visual review.

First joint300s run21-42: technicalPASS, readabilityFAIL. All phases/audio/face
were valid and no underrun occurred, but one explicit greeting received no typed
intent, and celebration's audible stroke moved only5mm despite a46cm preparation.
WI2 follow-up preserves relative source displacement inside compact workspaces,
whose absolute boundary projection otherwise erases small generated movement.
Clarify the existing initial LLM decision contract; do not force a hint in the
qualification fixture or add a natural-language router. Both failures stay recorded.

## Rejected candidates and retained failures

The timer-observed22-02 run confirmed another expiry defect: greeting preparation
started at136.7s and expired before its first PCM at151.5s. The original typed
proposal had already aged past its10s TTL. Reaffirm the same original decision
once at first prose only when expired, preserving the existing TTL and cancellation
rules. This is a separate WI1/WI2 follow-up, not a longer physical waiting deadline.
The same unperformed preparation was also starting both family and selection
cooldowns. Move their commit to actual applied gesture stroke; otherwise renewed
delivery is rejected by its own unused preparation's cooldown.

The first compact palm-up explanation numerically passed at seeds17/271 in
joint-21-04 and joint-21-08 but placed the elbow above the head. It was rejected
visually and replaced by an index-point explanation. The runner now separately
checks elbow height; the original reports remain unmodified.

Initial compact preparation failures in joint-20-58 / joint-21-11 exposed a
tracking cap tied to zero neural velocity while the admitted IK target still
needed substantial movement. The new reach-time regression failed with0.84rad
residual before correction. Preparation reaching now respects the original
speed/acceleration ceilings while using actual error and authored remaining time.

Joint-21-20 and21-23 retained a microscopic right-arm tangent contact during
greeting preparation. Joint-21-29 measured metric0.9999805244. The bounded3mm
preparation sweep reserve addresses that contact. A broader reserve initially
blocked an off-axis recovery regression and was rejected; recovery keeps its
original sweep policy. Joint-21-31 then exposed fingertip cropping for one
compact open palm; compact workspace extents were inset before execution.

No numerical success in these intermediate manual runs is an artistic PASS.
The draft360° turn planner is unchanged and remains excluded from automatic
conversational selection. Fish, speech HTTP, release version and user camera
settings are unchanged.

## Compact final candidate qualification

The phase-relative candidate passed real-rig seeds17/271 in joint-21-51 /
joint-21-52. Visual review then lowered its placement to avoid covering the mouth.
An outward variant in joint-21-53 was rejected for fingertip cropping. The final
region offset[0,-0.25,0] and extent scale0.5 passed seed271 in joint-21-55:
all3 gestures completed with zero contacts, no eye occlusion and100% stroke
visibility; stroke travel2.64/2.74/2.74cm. These3 profiles were then enabled for
automatic Face selection; all turn profiles remain draft/manual.

Short real Chat21-57 (40s, intentionally not a five-minute PASS): explanation,
explicit wave and celebration all met the unchanged audible-stroke/readability
criteria. Celebration moved1.89cm during audible stroke versus0.50cm before
the relative projection. The final full300s rerun is pending.

## Latest retained qualification results

-22-02:301s, technicalPASS/readabilityFAIL. Real PCM, Blink/LipSync, continuous
  breathing and return to presence worked; no motion errors or layer violations.
  The expired preparation case and small audible stroke remain explicit failures.
-22-09: the narrower quarter-size preparation experiment failed spatial readiness
  for all3 gestures. Rejected; final targets retain extent scale0.5 in every phase.
-22-15: another complete300s run technically passed but failed readable amplitude
  for explicit greeting and celebration. No artistic PASS.
-22-20: final-code short real speech after actual-stroke cooldown correction:
  greeting2.49cm and celebration2.14cm audible stroke, both readable, zero errors.
  Its overall result is intentionallyFAIL because40s is not300s.

The final cooldown change has a failing-before/passing-after deterministic repro:
preparation previously consumed the family cooldown without a performed stroke.
Main first-prose reaffirmation also has a deterministic11s provider-delay test.
The final300s recording is joint-22-23. Its overall result remains FAIL.

## Current completion boundary

WI1 confirmed clock-debt defect and pre-speech expiry/cooldown defects are fixed
and covered by permanent regressions. WI3 audit and WI4 capability-gated acting
are implemented. WI2 fixed-frustum selection and physical compact candidates
are implemented, but consistent audible-stroke amplitude remains unaccepted.
WI5 is not complete until both measured execution and joint visual judgment pass.
The implementation must not be described as AAA-quality or as a completed
artistic acceptance on the basis of compile/tests or selected successful cases.

## Final recorded run: joint-22-23

300.968s, real Main Character LLM/Fish/ARDY, fixed Face, Chat without Preview.
TechnicalPASS / measured readabilityFAIL / artistic acceptanceOPEN. No motion
errors, no facial stuck warnings, no layer violations; camera position/rotation/FOV
deltas all0. Idle chest excursion9.95mm; returned to base presence.

- Explicit greeting:2.136cm audible stroke, visible100%, PASS.
- Explanation:0.566cm audible stroke, visible100%, FAIL against1.5cm minimum.
- Celebration:1.468cm audible stroke, visible100%, FAIL against1.5cm minimum.
- Surprise/joy used actual surprised/happy facial profiles and supported morphs.

The raw video measured62.23FPS. The export contains H.26460FPS and AAC,
300.95s. Actual captured audio peak:-10.7dBFS, mean:-39.1dBFS across speech
and long idle gaps. No silent replacement audio or invented body frames.

Final review caught a cooldown commit guard that missed forecast-promoted stroke
because phaseAppliedFrame was already set. It now commits once per actually
applied execution ID. A deterministic test verifies both no cooldown in prepare
and an active cooldown after stroke. This last guard correction postdates the
300s recording; do not call that recording an exact-build qualification of the
last guard change. Final live client smoke and deterministic checks are separate.

The remaining body work is consistent readable stroke execution for explanation
and joy across generated variants and delayed speech, followed by another exact
final-source300s recording and user visual review. Current evidence does not close
WI2/WI5 or establish AAA acting quality. Blush, tears and eye glints remain P2.

## Validation status

Biome check / format / imports, TypeScript, 32-profile catalog synchronization and
46 Python motion tests passed. Biome reports 3 preexisting informational useTemplate
notes in qualifications/motion-ab/run.cjs, which this work does not touch.
The full Desktop regression after camera-specific fixture updates reached 639/640:
the remaining failure is unchanged BrowserControlScenarios.ts:1536, asserting
planExpirations>=1 in the provider-network failure scenario. Its focused repeat
also failed. No Browser source, expectation or timing was edited to hide it.
The reduced-concurrency complete rerun passed all 640 tests across 137 files
with maxWorkers=2, without Browser source or expectation changes. The final
production build also passed. The client was rebuilt and restarted; the user
stopped Computer Use with Escape before the final window smoke was confirmed.

On 28 October 2026 the user explicitly requested pushing the current work to origin
after being told that overall artistic acceptance remains FAIL. This publishes
the current implementation for review; it does not close WI2/WI5, qualify AAA
acting quality, authorize a release or turn the draft 360-degree planner on.
