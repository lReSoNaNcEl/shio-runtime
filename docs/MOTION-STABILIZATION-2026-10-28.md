# Motion Stabilization and Architecture Protection - 28 October 2026

## Architecture Review

Baseline: `68e97667e8d56cb778029a60ee78675ba477450d`, branch
`codex/experiment-ardy-fish-s2-pro-v1`. Initial working tree was clean.
The user subsequently authorized committing and pushing the current unfinished
work, after requesting that the running GPU test be stopped. Do not interpret
this snapshot as closure of the Motion Stabilization specification.

WI0 was completed first, changing only AGENTS.md before implementation began.
Architecture Change Control is now review-first and read-only by default.
Original architecture documents retain authority for architectural meaning.
Sections 2 and 11 and the introductory/release/Never Again references agree;
RCA, ownership, behavior preservation, testing and reports remain mandatory.
Protected specifications were reviewed, not edited.

Applicable preserved invariants:

- Avatar Runtime remains the body-composition and retargeting owner.
- Main owns the one ARDY Adapter; no second generator or Runtime was added.
- AudioPlayer owns consumed PCM; no new motion clock or presentation delay.
- The existing tracker remains the single body temporal integrator.
- Overlay consumes the primary composed pose; no extra breathing/body actor.
- Safety, support constraints and generated head/face exclusions remain active.
- Camera settings/presets, facial ownership, Fish, Speech/TTS/ASR, Character LLM
  provider, launcher, release/packaging/CI and draft turn data were not changed.

SHA-256 verified before and after implementation:

- ARCHITECTURE.md:
  `11e041297799c35857dc0f0942b22200049cfb84866a94b65fd05bdaeb05e5b9`
- AGENTS.md after WI0, frozen for subsequent Work Items:
  `d2733824eac0cf1461f5e5b536e2b19d55276a6d340b79e7bd5b6d50914d92ef`

Motion catalogue policy changes are limited to the four requested gesture
profiles. They do not change the protocol shape or Runtime ownership. The
canonical catalogue and its generated worker copy use revision
`expressive-v6-2026-10-28`; the worker revision guard was synchronized.

## What changed

- Stateless SQUAD reconstruction replaces piecewise source SLERP, using buffered
  neighbouring ARDY rotations and preserving original source poses/timestamps.
- The existing position/velocity tracker uses an analytic critically damped step
  with moving-target feed-forward. Existing speed/acceleration ceilings remain.
- Reconciliation retains analytic endpoint velocity when safety did not change
  the integrated rotation; actual safety projections still reconcile momentum.
- `greet_wave_soft`, `explain_one_palm`, `explain_balance`, `celebrate_petite`
  consume a two-second stroke horizon (2000 ms minimum, 2600 ms maximum).
  Speech cancellation/expiry and physical exit conditions remain authoritative.
- Opt-in qualification records source, reconstruction, retarget, anatomy,
  workspace, temporal, contact, procedural, final/VRM and Spring Bone evidence,
  separate wall/source/PCM positions and bounded full source horizons.
- Diagnostics include a static-source intervention, 60-second real idle cases,
  identical-source procedural and visual comparisons, and real conversation
  stage capture. They never replace production neural generation.
- Large diagnostic series transfer in bounded batches after simultaneous probe
  stop. Raw poses remain qualification artifacts, not Runtime/IPC diagnostics.
- Regression coverage includes source knots/velocity/sign, 60/90/120 Hz PCM
  reports, tracker chatter rejection, reach/fast stroke and full source timing.

## Root Cause

There are several distinct measured sources; this is not a claim that all
remaining perceptual jitter has been eliminated.

1. Actual ARDY idle output already contains high-frequency angular noise.
   Example baseline poised right upper arm: source acceleration P95 36.25 rad/s2,
   jerk P95 2659 rad/s3; the existing final presence path reduced these to
   0.987 rad/s2 and 62.7 rad/s3 but did not remove every visible component.
2. Piecewise 30 Hz SLERP preserves position while changing angular velocity
   discontinuously at source knots. The old tracker followed desired velocity
   immediately whenever its acceleration budget allowed it; gesture
   feed-forward transmitted/amplified target derivative noise.
3. Reconciliation previously overwrote velocity every frame, even when safety
   accepted the entire integrated rotation unchanged. That loses the analytic
   endpoint velocity needed by the corrected tracker.
4. Short stroke budgets/forecasting replaced an unconsumed neural suffix.
   A real explanation consumed about 28 of 60 source frames: right-hand raw FK
   excursion in the consumed prefix was 0.01705 m versus 0.02901 m in the full
   source horizon. Preserving that suffix improves fidelity, but does not
   guarantee a readable gesture for every generated source.

Negative evidence: a valid constant-source 60-second test produces stationary
hips and upper/lower arms in both primary and Overlay, with breathing and head
motion still active. Chest velocity P95 0.002406 rad/s and acceleration
0.00434 rad/s2 are slow procedural motion. Repeated correction counts alone do
not establish a limit cycle. Identical-source none/breath/micro/full replay has
nearly identical angular spikes; no repeated procedural feedback cause was
proved in these cases. No safety/breathing/Spring disabling was introduced.
The offline composition fixture does not simulate Springs; live probes do.

Diagnostic errors were identified and corrected rather than attributed to the
engine: the first static intervention failed to freeze the queued interpolation
neighbour, creating artificial two-second jumps. Sequentially exporting the
primary series before stopping Overlay also added an unfrozen tail. The valid
repeat freezes both horizons, asserts constant input and clips older Overlay
series to the primary absolute stop timestamp. An earlier long trace failed
while returning one huge renderer payload; batching replaces that transfer.

## Why the fix works, and its limits

Reconstruction removes source interpolation corners without stretching time or
inventing gesture accents. The analytic step shapes the same tracker state
rather than adding a second filter. Preserving the source window retains
neural movement rather than fabricating displacement to pass a threshold.
The pinned model has ten native base/denoising steps; increasing to 20/50 is not
supported. Native optional postprocessing concerns root/foot constraints and is
not evidence of a missing general upper-body denoiser.

Identical captured source, 60 Hz composition, seed 17, same user VRM:

| Profile, right upper arm | Jerk P95 baseline / candidate (rad/s3) | High-band power reduction | Stroke excursion retained |
| --- | ---: | ---: | ---: |
| presence_speaking | 28.70 / 12.22 | 32% | 99.9% |
| explain_one_palm | 1005.12 / 465.68 | 49% | 98.9% |
| greet_wave_soft | 2637.18 / 1253.81 | 47% | 99.0% |
| celebrate_petite | 2924.29 / 1433.28 | 50% | 95.9% |

Unresolved contacts were zero in these four deterministic comparisons. Less
travel than baseline is partly removal of chatter; preserved excursion does not
prove artistic quality. Fresh online generations differ and are not an
identical-source A/B comparison.

## Files

Governance: AGENTS.md. Runtime: AdaptiveMotionFilter, GeneratedBodyPlayback,
sampleSourceRotation, MotionDynamicsObserver under
`apps/desktop/src/renderer/avatar/rendering/three/`.
Motion data: `contracts/motion.v1.json`, its generated
`apps/desktop/motion/motion-profiles.json`, and worker `protocol.py` revision.
Qualification: speech-motion qualify/conversation/dynamics helpers plus
stabilization-cases, stabilization-analysis and horizon-coverage.
Tests: unit Avatar source/filter/clock/phase and integration phase playback.
No generated videos, raw poses, models, credentials, build outputs or virtual
environments belong in the commit.

## Checks and evidence

Hardware: RTX 5090, driver 610.88. User VRM SHA-256
`bac0c6eb597e3840241f0d319f7cfeace0621a0b198129aa778fd76aba1a4fac`.
ARDY source revision `e706e27acc88070918308a10922b8f7174d0825e`;
SOMA30 checkpoint `244215084b22fcd29ab743017330e87411fe168a`.
User Bust camera 360 x 560, scale 1. No competing GPU qualification jobs.

Ignored evidence under `apps/desktop/motion/.artifacts/`:

- `joint-2026-10-28T09-27-42-936Z`: baseline real poised/warm idle.
- `joint-2026-10-28T09-34-44-224Z`: corrected valid static baseline.
- `joint-2026-10-28T09-54-53-277Z`: candidate static plus both 60-second
  idle episodes; recorded 61-62 FPS, constant-source/camera checks passed.
- `stabilization-2026-10-28/{none,breathing,micro,full,c1,critical}`:
  identical captured source SHA-256
  `d482e1ce547b358461a104151480dc00e3fe91283d9431b9ab643d3199bcfb49`.
- `joint-2026-10-28T10-00-15-799Z`: earlier 300-second conversation capture
  at 62.14 FPS; subsequent large trace export failed. Not a full PASS.
- `joint-2026-10-28T10-08-26-261Z`: short natural explanation/greeting
  diagnostic with complete source horizons and stage export, 61.27 FPS.
- `joint-2026-10-28T10-10-30-900Z`: identical-source visual comparisons.
  First baseline presence clip was 55.14 FPS; other clips 62+ FPS.
  The >=60 FPS gate was not weakened; overall comparison is not a PASS.
- `joint-2026-10-28T10-15-23-711Z`: final v6 conversation; explicitly
  stopped by the user and marked interrupted, not qualified. Stage export,
  final preview/health smoke and final video acceptance are incomplete.

Last recorded final-conversation working-phase wrist excursions:

| Case | Excursion | Numeric readability |
| --- | ---: | --- |
| Ordinary greeting | 0.043825 m | PASS |
| Explanation | 0.005218 m | FAIL |
| Explicit greeting | 0.011396 m | FAIL |
| Celebration | 0.060373 m | PASS |

Thus explanation/greeting robustness is still unfinished; extending the source
window did not by itself solve the artistic/readability problem. No threshold
was lowered and no procedural accent was added.

Analysis calibration passed for constant angular speed, zero acceleration and
quaternion sign changes. Fast suite: 223 tests; Python motion suite: 46 tests.
Desktop Biome, format/import checks, typecheck and build passed. Three existing
Biome informational template suggestions remain in unrelated motion-ab code.
The last general regression runs exposed unrelated Browser Control timing
failures; the phase-playback fixture was updated to use a genuinely overlapping
short-stroke forecast and its 33 focused tests passed. Final pre-push validation
results are appended below.

## Limitations and remaining acceptance

- WI0: PASS. WI1-WI3: measured evidence and implemented improvements; full final
  live acceptance remains incomplete.
- WI4: FAIL for robust explanation and explicit greeting readability.
- WI5: live quiet-presence evidence exists; final full review remains incomplete.
- WI6 / Technical Acceptance: INCOMPLETE, latest test stopped by user.
- Motion Continuity: improved in identical-source measurements, final visual
  acceptance PENDING.
- Gesture Readability: FAIL on the latest explanation/greeting cases.
- Artistic Acceptance: PENDING USER REVIEW; no claim of AAA quality.
- The user requested stopping the test, then pushing the current work. GPU tests
  were not restarted to prepare the push. API port 8000 remained owned by the
  same external service process and /health returned HTTP 200 after test stop.

### Final pre-push validation

- `desktop:check`, `desktop:format:check`, `desktop:imports:check`: PASS.
- `desktop:test:fast`: PASS, 223 tests.
- `desktop:test:regression -- --maxWorkers=2`: PASS, 140 files / 665 tests,
  final run started 13:29:12 local time, duration 63.61 seconds.
- The preceding serial regression attempt had 664 passes and one unrelated
  Browser Continuous Control failure creating a Chrome tab. Its subsequent
  full-suite rerun passed; Browser implementation/tests were not changed.
- `motion:research:test`: PASS, 46 tests.
- `typecheck`, `build` (including speech asset verification): PASS.
- Motion catalogue synchronization, changed Python Ruff lint/format, analysis
  calibration, `git diff --check` and protected/frozen SHA-256 guards: PASS.
- Runtime owners, Speech API and user camera remain unchanged. No GPU test was
  restarted after the user's stop request. This push is an implementation
  snapshot with the remaining visual/readability failures documented above.
