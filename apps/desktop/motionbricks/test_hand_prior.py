"""Prior-space semantic regression, with no native assets or mesh claims."""

import copy
import json
import unittest
from pathlib import Path

import numpy as np
from hand_prior import HandPrior
from scipy.spatial.transform import Rotation


class HandTests(unittest.TestCase):
    def setUp(self):
        catalog = json.loads(
            (
                Path(__file__).resolve().parents[1] / "motion/motion-profiles.json"
            ).read_text()
        )
        self.profile = next(
            p for p in catalog["profiles"] if p["id"] == "explain_one_palm"
        )
        self.hand = HandPrior.__new__(HandPrior)
        components = np.linalg.qr(np.random.default_rng(17).normal(size=(72, 32)))[0].T
        mean = np.zeros((24, 3))
        mean[:, 0] = 0.2
        prior = {
            "mean": mean,
            "components": components,
            "deviations": np.ones(32),
            "basis": np.array([0, 0, 0, 1]),
            "reference_orient": np.tile(np.eye(3), (25, 1, 1)),
            "reference_orient_parent": np.tile(np.eye(3), (25, 1, 1)),
            "parents": np.array([-1] + [0] * 24),
            "directions": np.tile([0.0, 1.0, 0.0], (15, 1)),
        }
        self.hand.sides = {"left": copy.deepcopy(prior), "right": copy.deepcopy(prior)}
        self.hand.reset()

    def test_spread_and_thumb_opposition_survive_semantic_target_construction(self):
        score = copy.deepcopy(self.profile["handScore"]["phases"]["stroke"]["right"])
        for shape in score["fingers"].values():
            shape.update(curl=[0, 0, 0], spread=0, opposition=0)
        before = self.hand.target_expmap("right", score)
        score["fingers"]["index"]["spread"] = 0.25
        score["fingers"]["thumb"]["opposition"] = 0.3
        after = self.hand.target_expmap("right", score)
        self.assertAlmostEqual(after[5, 2] - before[5, 2], -0.25)
        self.assertAlmostEqual(after[0, 1] - before[0, 1], 0.3)
        self.assertGreater(
            np.linalg.norm(self.hand.target_coefficients("right", score)), 0.1
        )

    def test_rollback_uses_exact_body_cursor_and_keeps_wrist_out_of_transport(self):
        first = self.hand.generate(0, self.profile, "prepare")
        repeated = self.hand.generate(0, self.profile, "prepare")
        np.testing.assert_allclose(first["rotations"], repeated["rotations"])
        stroke = self.hand.generate(16, self.profile, "stroke")
        rotations = np.array(stroke["rotations"])
        self.assertEqual(rotations.shape, (60, 30, 4))
        np.testing.assert_allclose(np.linalg.norm(rotations, axis=-1), 1)
        self.assertGreater(np.linalg.norm(rotations[0] - rotations[15]), 0.01)

    def test_base_articulation_survives_prior_coupling_to_distal_joints(self):
        prior = self.hand.sides["right"]
        prior["mean"][:] = 0
        prior["components"][:] = 0
        # One statistical degree couples MCP abduction and distal bending.
        # Losing half the base opening is not a correct straight-finger target.
        prior["components"][0, 5 * 3 + 2] = 2**-0.5
        prior["components"][0, 7 * 3] = 2**-0.5
        score = copy.deepcopy(self.profile["handScore"]["phases"]["stroke"]["right"])
        for shape in score["fingers"].values():
            shape.update(curl=[0, 0, 0], spread=0, opposition=0)
        score["fingers"]["index"]["spread"] = 0.25
        coefficients = self.hand.target_coefficients("right", score)
        fitted = (coefficients * prior["deviations"]) @ prior["components"]
        self.assertLess(abs(fitted[5 * 3 + 2] + 0.25), 0.05)
        self.assertLess(abs(fitted[7 * 3]), 0.25)
        self.assertTrue(np.all(np.abs(coefficients) <= 2.5))

    def test_opposed_straight_fingers_keep_signed_palm_plane_opening(self):
        prior = self.hand.sides["right"]
        prior["mean"][:] = 0
        prior["components"][:] = 0
        # A broad flexion mode competes with a smaller independent spread mode.
        # An unsigned inter-finger angle can pass while the two fingers converge.
        prior["components"][0, 5 * 3 + 2] = 2**-0.5
        prior["components"][0, 15 * 3] = 2**-0.5
        prior["components"][1, 5 * 3 + 2] = 2**-0.5
        prior["components"][1, 15 * 3] = -(2**-0.5)
        prior["deviations"][1] = 0.2
        prior["components"][2, 10 * 3 + 2] = 1
        score = copy.deepcopy(self.profile["handScore"]["phases"]["stroke"]["right"])
        for shape in score["fingers"].values():
            shape.update(curl=[0, 0, 0], spread=0, opposition=0)
        score["fingers"]["index"]["spread"] = 0.14
        score["fingers"]["middle"]["spread"] = -0.14
        score["fingers"]["ring"]["curl"][0] = 1.1
        coefficients = self.hand.target_coefficients("right", score)
        directions = Rotation.from_quat(
            self.hand.decode("right", coefficients[None])[0]
        ).apply(prior["directions"])
        self.assertGreater(directions[3, 0] - directions[6, 0], 0.2)
        self.assertGreater(directions[9, 2], 0.3)
        self.assertTrue(np.all(np.abs(coefficients) <= 2.5))

    def test_settled_articulation_reaches_the_complete_native_fitted_endpoint(self):
        prior = self.hand.sides["right"]
        prior["mean"][:] = 0
        prior["components"][:] = 0
        # A native metacarpal and its selected VRM proximal joint share a mode.
        # Dropping the parent during per-finger interpolation halves that mode
        # when the full pose is projected back into the same PCA manifold.
        prior["components"][0, 4 * 3 + 2] = 2**-0.5
        prior["components"][0, 5 * 3 + 2] = 2**-0.5
        profile = copy.deepcopy(self.profile)
        score = profile["handScore"]["phases"]["hold"]["right"]
        for shape in score["fingers"].values():
            shape.update(curl=[0, 0, 0], spread=0, opposition=0)
        score["fingers"]["index"]["spread"] = 0.25
        expected = self.hand.target_coefficients("right", score)
        self.hand.generate(0, profile, "hold", {"executionId": "complete-endpoint"})
        np.testing.assert_allclose(self.hand.history["right"][59], expected, atol=1e-6)


if __name__ == "__main__":
    unittest.main()
