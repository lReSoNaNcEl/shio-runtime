"""Standing conversion contracts without an inference engine or GPU."""

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from conversion import world_poses
from scipy.spatial.transform import Rotation
from standing_pose import ASSET, apply_deltas, load_standing_pose, reference_digest


class StandingPoseTests(unittest.TestCase):
    def test_world_delta_precedes_non_identity_bind_and_preserves_lengths(self):
        reference = np.array(
            [
                [0, 1, 0, *Rotation.from_euler("z", 90, degrees=True).as_quat()],
                [1, 0, 0, *Rotation.from_euler("x", 30, degrees=True).as_quat()],
                [0.5, 0, 0, 0, 0, 0, 1],
            ]
        )
        parents = np.array([-1, 0, 1])
        delta = Rotation.from_euler("y", 40, degrees=True)
        pose = apply_deltas(
            reference, parents, ["Hips", "LeftArm", "Finger"], {"LeftArm": delta.as_quat()}
        )
        before, after = (world_poses(value[None], parents)[0] for value in (reference, pose))
        expected = delta * Rotation.from_quat(before[1, 3:])
        self.assertLess((expected.inv() * Rotation.from_quat(after[1, 3:])).magnitude(), 1e-8)
        np.testing.assert_array_equal(reference[:, :3], pose[:, :3])
        np.testing.assert_array_equal(reference[2], pose[2])

    def test_reference_digest_is_sensitive_to_bind_orientation(self):
        first = np.array([[0, 1, 0, 0, 0, 0, 1]], dtype=np.float32)
        other = first.copy()
        other[0, 3:] = Rotation.from_euler("x", 10, degrees=True).as_quat()
        self.assertNotEqual(reference_digest(first), reference_digest(other))

    def test_asset_has_exact_traceable_source_and_excludes_protected_channels(self):
        value = json.loads(ASSET.read_text())
        self.assertEqual(value["source"]["gitRevision"], "39310f0d7a17616c30e2becdeeda845670353320")
        self.assertEqual(len(value["source"]["sha256"]), 64)
        self.assertGreater(value["source"]["sampledTimestampSeconds"], 0)
        self.assertFalse(
            any(name in value["worldDeltas"] for name in ("Head", "Neck1", "Jaw", "LeftHandIndex1"))
        )
        quaternions = np.array(list(value["worldDeltas"].values()))
        np.testing.assert_allclose(np.linalg.norm(quaternions, axis=1), 1)

    def test_rejects_incompatible_skeleton_before_applying_pose(self):
        with self.assertRaisesRegex(ValueError, "identity"):
            load_standing_pose(np.array([[0, 1, 0, 0, 0, 0, 1]]), [-1], ["Hips"])

    def test_rejects_nonfinite_height(self):
        value = json.loads(ASSET.read_text())
        reference = np.tile([0.0, 0, 0, 0, 0, 0, 1], (len(value["jointNames"]), 1))
        value["referenceSha256"] = reference_digest(reference)
        value["rootHeightM"] = float("nan")
        with tempfile.TemporaryDirectory(dir=ASSET.parent.parent / ".tmp") as directory:
            path = Path(directory) / "pose.json"
            path.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError, "height"):
                load_standing_pose(reference, value["parents"], value["jointNames"], path)


if __name__ == "__main__":
    unittest.main()
