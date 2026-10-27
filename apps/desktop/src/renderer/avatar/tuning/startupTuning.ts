export const avatarStartupTuning = {
  initialAnimationTimeoutMs: 5_000,
  rootPosition: { x: 0, y: 0, z: 0 },
  rootRotation: { x: 0, y: 0, z: 0 },
  camera: {
    fov: 30,
    near: 0.1,
    far: 100,
    // Startup defaults to the VRM0 -Z front. The loaded model's metadata makes
    // presentation presets use +Z for VRM1 without rotating the model itself.
    position: { x: 0, y: 1.4, z: -2.5 },
    target: { x: 0, y: 1.0, z: 0 },
  },
} as const
