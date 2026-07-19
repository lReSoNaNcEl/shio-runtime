export const avatarStartupTuning = {
  initialAnimationTimeoutMs: 5_000,
  rootPosition: { x: 0, y: 0, z: 0 },
  rootRotation: { x: 0, y: 0, z: 0 },
  camera: {
    fov: 30,
    near: 0.1,
    far: 100,
    // VRM scenes load facing -Z (glTF/three.js front-facing convention, unchanged
    // by VRMLoaderPlugin). The camera must sit on the -Z side to frame the front
    // of the model, matching the convention already used by `overlayCameraPresets`.
    position: { x: 0, y: 1.4, z: -2.5 },
    target: { x: 0, y: 1.0, z: 0 },
  },
} as const
