# WI23 - Full VRMA Ownership Audit

Date: 2026-07-08

## Scope

Audited every VRMA listed in `src/renderer/avatar/animationManifest.ts`.

Total manifest VRMA entries: 34
Missing assets: 0

## Architecture Finding

Avatar Runtime owns body playback, while Facial Runtime / Expression Mixer / LookAt own mouth, expressions, blinking and gaze. Therefore body VRMA clips must not write facial-control tracks into the `AnimationMixer`.

Current runtime order is:

```text
VRMA
  -> createVRMAnimationClip()
  -> Track Filter
  -> AnimationMixer.clipAction()
  -> Avatar Runtime playback
```

Forbidden tracks are filtered before `AnimationMixer.clipAction()`, so they do not reach `AnimationMixer`.

## Summary

| Finding | Count |
| --- | ---: |
| VRMA audited | 34 |
| Missing assets | 0 |
| Jaw tracks | 14 |
| Eye tracks | 29 |
| Morph / expression tracks | 0 |
| LookAt / gaze tracks | 0 |
| Unknown tracks | 0 |
| Hips.position tracks | 34 |
| Root.position tracks | 0 |

`Hips.position` appears in every clip and is treated as skeletal pose, not world root motion.

## Strip Policy

### Always Strip Before Mixer

- `jaw.*`
- `leftEye.*`
- `rightEye.*`
- `tongue.*`
- `eyelid.*`
- `leftEyelid.*`
- `rightEyelid.*`
- `*.weight`
- `blink.*`
- `lookAt.*`
- `look_at.*`
- `gaze.*`
- `eyeTarget.*`
- `eye_target.*`
- `expression.*`
- `blendShape.*`
- `blendshape.*`
- `morph.*`

### May Remain

- `head.rotation`
- `neck.rotation`
- `hips.translation`
- `hips.rotation`
- regular body bone `rotation`
- regular body bone `translation`

## Compatibility Table

| Animation | Body | Jaw | Eyes | Morph | LookAt | Runtime Safe | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| neutral_idle | Body + Facial Bones | - | yes | - | - | yes, after strip | strip eyes before mixer |
| neutral2 | Body + Facial Bones | - | yes | - | - | yes, after strip | strip eyes before mixer |
| neutral4 | Body + Facial Bones | - | yes | - | - | yes, after strip | strip eyes before mixer |
| idle_presence_sway_01 | Body Only | - | - | - | - | yes | leave unchanged |
| idle_presence_sway_02 | Body Only | - | - | - | - | yes | leave unchanged |
| idle_presence_swing_01 | Body Only | - | - | - | - | yes | leave unchanged |
| idle_presence_swing_02 | Body Only | - | - | - | - | yes | leave unchanged |
| idle_presence_dance_01 | Body Only | - | - | - | - | yes | leave unchanged |
| action_greeting | Body + Facial Bones | - | yes | - | - | yes, after strip | strip eyes before mixer |
| action_greeting1 | Body + Facial Bones | - | yes | - | - | yes, after strip | strip eyes before mixer |
| approval | Mixed | yes | yes | - | - | yes, after strip | strip jaw + eyes; keep excluded from ordinary speaking |
| admiration | Body + Facial Bones | - | yes | - | - | yes, after strip | strip eyes before mixer |
| gratitude | Mixed | yes | yes | - | - | yes, after strip | strip jaw + eyes before mixer |
| optimism | Mixed | yes | yes | - | - | yes, after strip | strip jaw + eyes before mixer |
| caring | Mixed | yes | yes | - | - | yes, after strip | strip jaw + eyes before mixer |
| amusement | Body + Facial Bones | - | yes | - | - | yes, after strip | strip eyes before mixer |
| curiosity | Mixed | yes | yes | - | - | yes, after strip | strip jaw + eyes; idle usage only |
| confusion | Mixed | yes | yes | - | - | yes, after strip | strip jaw + eyes before mixer |
| confusion2 | Body + Facial Bones | - | yes | - | - | yes, after strip | strip eyes before mixer |
| annoyance | Body + Facial Bones | - | yes | - | - | yes, after strip | strip eyes before mixer |
| anger | Mixed | yes | yes | - | - | yes, after strip | strip jaw + eyes before mixer |
| anger2 | Body + Facial Bones | - | yes | - | - | yes, after strip | strip eyes before mixer |
| disapproval | Mixed | yes | yes | - | - | yes, after strip | strip jaw + eyes before mixer |
| disgust | Mixed | yes | yes | - | - | yes, after strip | strip jaw + eyes before mixer |
| embarrassment | Mixed | yes | yes | - | - | yes, after strip | strip jaw + eyes before mixer |
| excitement | Mixed | yes | yes | - | - | yes, after strip | strip jaw + eyes; keep excluded from ordinary speaking |
| pride | Mixed | yes | yes | - | - | yes, after strip | strip jaw + eyes; no current behavior usage |
| relief1 | Body + Facial Bones | - | yes | - | - | yes, after strip | strip eyes before mixer |
| sit_idle2 | Body + Facial Bones | - | yes | - | - | yes, after strip | strip eyes before mixer; not speaking usage |
| sit_idle3 | Body + Facial Bones | - | yes | - | - | yes, after strip | strip eyes before mixer; not speaking usage |
| hitarea_head | Mixed | yes | yes | - | - | yes, after strip | strip jaw + eyes; keep reaction-only |
| hitarea_butt | Body + Facial Bones | - | yes | - | - | yes, after strip | strip eyes before mixer; idle usage only |
| dance_pushback | Body + Facial Bones | - | yes | - | - | yes, after strip | strip eyes before mixer; keep excluded from ordinary speaking |
| desire | Mixed | yes | yes | - | - | yes, after strip | strip jaw + eyes; optional/reaction only |

## Body Ownership Audit

No `tongue`, `eyelid`, `morph`, `expression`, `blendshape`, `lookAt`, `gaze`, or unknown tracks were found in the current library.

The only ownership violations found are:

- `jaw.rotation`
- `leftEye.rotation`
- `rightEye.rotation`

These belong to Facial Runtime / LookAt, not body playback.

## Manifest Recommendation

The manifest already has semantic `usage` gates. Do not duplicate raw track facts there by default. Track facts are derived asset metadata and are safer to compute through tooling/debug output.

Recommended optional future format if persistent diagnostics become useful:

```ts
assetAudit?: {
  facialBones: boolean
  jawTracks: boolean
  eyeTracks: boolean
  morphTracks: boolean
  lookAtTracks: boolean
  unknownTracks: readonly string[]
}
```

This should be generated, not manually curated, to avoid drift.

## RCA

The approval LipSync regression was not caused by LipSync detaching or by missing viseme values. `approval.vrma` contains `jaw.rotation`, so body animation wrote to a facial-control bone while LipSync wrote viseme expressions. That violates Single Writer Ownership and can visually suppress mouth motion.

The runtime now strips forbidden facial-control tracks before `AnimationMixer.clipAction()`. Speaking Scheduler also excludes `approval` and `excitement` from ordinary speech through manifest `usage.speaking = false`.
