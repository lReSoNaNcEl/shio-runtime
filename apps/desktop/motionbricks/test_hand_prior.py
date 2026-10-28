"""Prior-space semantic regression, with no native assets or mesh claims."""

import copy
import json
import unittest
from pathlib import Path

import numpy as np
from hand_prior import HandPrior


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


if __name__ == "__main__":
    unittest.main()
