"""Deterministic planner/protocol checks; no models, GPU, or cached assets."""

import copy
import json
import unittest
from pathlib import Path

import numpy as np
from activity import accent_deadline_ms, validate_activity
from conversion import world_poses
from scipy.spatial.transform import Rotation
from targets import TargetPlanner, target_token_count


class PlannerTests(unittest.TestCase):
    def setUp(self):
        self.catalog = json.loads(
            (
                Path(__file__).resolve().parents[1] / "motion/motion-profiles.json"
            ).read_text()
        )
        self.names = ["Hips", "Spine1", "Spine2", "Chest", "Neck1", "Head"]
        parents = [-1, 0, 1, 2, 3, 4]
        positions = [
            [0, 0.95, 0],
            [0, 0.12, 0],
            [0, 0.12, 0],
            [0, 0.1, 0],
            [0, 0.12, 0],
            [0, 0.1, 0],
        ]
        for side, sign in (("Left", 1), ("Right", -1)):
            self.names.extend(
                side + part
                for part in ("Arm", "ForeArm", "Hand", "Leg", "Shin", "Foot", "ToeBase")
            )
            base = len(parents)
            parents.extend([3, base, base + 1, 0, base + 3, base + 4, base + 5])
            positions.extend(
                [
                    [sign * 0.2, 0.05, 0],
                    [sign * 0.3, 0, 0],
                    [sign * 0.27, 0, 0],
                    [sign * 0.1, 0, 0],
                    [0, -0.4, 0],
                    [0, -0.4, 0],
                    [0, 0, 0.1],
                ]
            )
        self.parents = np.array(parents)
        self.standing = np.c_[positions, np.tile([0, 0, 0, 1], (len(parents), 1))]
        self.history = np.repeat(self.standing[None], 4, axis=0)
        self.planner = TargetPlanner(
            self.names, self.parents, self.standing, self.catalog["handWorkspaces"]
        )

    def profile(self, name):
        return next(p for p in self.catalog["profiles"] if p["id"] == name)

    def test_phase_targets_do_not_repeat_preparation_or_randomize_each_block(self):
        for name in ("explain_point_close", "explain_one_palm"):
            profile = self.profile(name)
            world = world_poses(self.history, self.parents)
            plan = {"executionId": name}
            prepare = self.planner.destinations(world, profile, "prepare", 17, plan)[
                "right"
            ]
            stroke = self.planner.destinations(world, profile, "stroke", 17, plan)[
                "right"
            ]
            self.assertGreater(np.linalg.norm(stroke - prepare), 0.025)
            changed = world.copy()
            changed[:, :, :3] += 0.1
            np.testing.assert_array_equal(
                stroke,
                self.planner.destinations(changed, profile, "stroke", 999, plan)[
                    "right"
                ],
            )

    def test_seeds_vary_pose_goals_without_changing_support_or_spawning_trajectories(
        self,
    ):
        profile = self.profile("explain_one_palm")
        goals = []
        for seed in (17, 101, 271):
            self.planner.reset()
            goal = self.planner.goal(self.history, profile, "stroke", seed, None)
            self.assertTrue(np.isfinite(goal).all())
            np.testing.assert_array_equal(goal[0], self.standing[0])
            for name in ("LeftLeg", "RightLeg", "LeftFoot", "RightFoot"):
                np.testing.assert_array_equal(
                    goal[self.names.index(name)], self.standing[self.names.index(name)]
                )
            goals.append(goal)
        self.assertGreater(np.linalg.norm(goals[0] - goals[1]), 0.001)

    def test_replanning_cache_is_bounded_and_resettable(self):
        world = world_poses(self.history, self.parents)
        for i in range(60):
            self.planner.destinations(
                world,
                self.profile("explain_one_palm"),
                "prepare",
                17,
                {"executionId": str(i)},
            )
        self.assertLessEqual(len(self.planner.goals), 12)
        self.assertLessEqual(len(self.planner.variations), 6)
        self.planner.reset()
        self.assertFalse(self.planner.goals)

    def test_activity_contains_only_finite_bounded_metadata(self):
        activity = {
            "energy": 0.1,
            "playbackId": "a",
            "speaking": True,
            "prosody": {
                "throughSample": 4410,
                "sampleRate": 44100,
                "envelope": [0.1],
                "phase": "speech",
                "accent": 0,
                "leadMs": 0,
            },
        }
        self.assertEqual(validate_activity(activity), activity)
        for key, value in (
            ("accent", float("nan")),
            ("envelope", [0.1] * 13),
            ("throughSample", True),
            ("text", "words"),
        ):
            bad = copy.deepcopy(activity)
            bad["prosody"][key] = value
            with self.assertRaises(ValueError):
                validate_activity(bad)

    def test_native_stroke_endpoint_fits_the_actual_phase_without_retiming_source(self):
        for name in ("explain_point_close", "explain_one_palm"):
            profile = self.profile(name)
            tokens = target_token_count(profile, "stroke")
            budget = next(p["minMs"] for p in profile["phases"] if p["id"] == "stroke")
            self.assertLessEqual((tokens * 4 - 7) * 1000 / 30, budget)
            self.assertGreaterEqual(tokens, 6)
            self.assertLessEqual(tokens, 16)
        self.assertEqual(
            target_token_count(self.profile("explain_point_close"), "stroke"), 7
        )
        self.assertIsNone(target_token_count(self.profile("presence_poised"), "stroke"))

    def hand(self, goal, side):
        return world_poses(goal[None], self.parents)[0][
            self.names.index(side + "Hand"), :3
        ]

    def test_speaking_presence_raises_hands_and_alternates_beats(self):
        profile = self.profile("presence_speaking")
        activity = {
            "energy": 0.12,
            "playbackId": "a",
            "speaking": True,
            "prosody": {
                "throughSample": 4410,
                "sampleRate": 44100,
                "envelope": [0.12, 0.15],
                "phase": "speech",
                "accent": 0,
                "leadMs": 0,
            },
        }
        hips = self.standing[0, :3]
        shoulder = world_poses(self.standing[None], self.parents)[0][
            self.names.index("RightArm"), :3
        ]
        goals = [
            self.planner.goal(self.history, profile, "hold", seed, activity)
            for seed in (17, 18, 19, 20)
        ]
        for goal in goals:
            self.assertTrue(np.isfinite(goal).all())
            for side in ("Left", "Right"):
                hand = self.hand(goal, side)
                # Forearms forward: hands in front of the torso, between the
                # hips and the shoulders, independent of the rig's rest pose.
                self.assertGreater(hand[2] - hips[2], 0.1)
                self.assertGreater(hand[1], hips[1] + 0.05)
                self.assertLess(hand[1], shoulder[1])
        # Talking presence uses shorter native blocks; quiet presence keeps
        # the model's own token choice.
        self.assertEqual(target_token_count(profile, "hold", activity), 7)
        self.assertIsNone(
            target_token_count(profile, "hold", dict(activity, speaking=False))
        )
        beats = [self.hand(goal, "Right") for goal in goals]
        self.assertGreater(
            max(np.linalg.norm(a - b) for a, b in zip(beats, beats[1:])), 0.02
        )

    def chest_yaw(self, goal):
        chest = world_poses(goal[None], self.parents)[0][self.names.index("Chest")]
        forward = Rotation.from_quat(chest[3:]).apply([0, 0, 1])
        return float(np.arctan2(forward[0], forward[2]))

    def test_torso_turns_toward_acting_hand_without_accumulating(self):
        gesture = self.profile("explain_one_palm")
        stroke = self.planner.goal(self.history, gesture, "stroke", 17, None)
        # Right-led act: the upper body turns toward the right (negative yaw).
        self.assertLess(self.chest_yaw(stroke), -0.05)
        presence = self.profile("presence_speaking")
        activity = {
            "energy": 0.2,
            "playbackId": "a",
            "speaking": True,
            "prosody": {
                "throughSample": 4410,
                "sampleRate": 44100,
                "envelope": [0.2],
                "phase": "speech",
                "accent": 0,
                "leadMs": 0,
            },
        }
        history = self.history
        yaws = []
        for seed in range(30, 50):
            goal = self.planner.goal(history, presence, "hold", seed, activity)
            yaws.append(self.chest_yaw(goal))
            history = np.repeat(goal[None], 4, axis=0)
        # Goals are relative to standing: bounded, never accumulating.
        self.assertLess(max(abs(value) for value in yaws), 0.2)
        self.assertGreater(max(abs(value) for value in yaws), 0.05)
        quiet = self.profile("presence_poised")
        idle = self.planner.goal(self.history, quiet, "hold", 7, None)
        np.testing.assert_array_equal(
            idle[self.names.index("Chest")], self.history[-1][self.names.index("Chest")]
        )

    def test_pause_settles_and_end_of_speech_returns_raised_hands(self):
        profile = self.profile("presence_speaking")
        activity = {
            "energy": 0.0,
            "playbackId": "a",
            "speaking": True,
            "prosody": {
                "throughSample": 4410,
                "sampleRate": 44100,
                "envelope": [0.0],
                "phase": "pause",
                "accent": 0,
                "leadMs": 0,
            },
        }
        talking = self.planner.goal(self.history, profile, "hold", 17, activity)
        history = np.repeat(talking[None], 4, axis=0)
        silent = dict(activity, speaking=False, prosody=None)
        settled = self.planner.goal(history, profile, "hold", 18, silent)
        rest = self.hand(self.standing, "Right")
        self.assertLess(
            np.linalg.norm(self.hand(settled, "Right") - rest),
            np.linalg.norm(self.hand(talking, "Right") - rest) * 0.75,
        )
        self.assertEqual(self.planner.beat, 0)

    def test_only_available_audible_accents_modulate_native_duration(self):
        energy = [0.1] * 30
        energy[15] = 0.8
        activity = {
            "energy": 0.1,
            "playbackId": "a",
            "speaking": True,
            "prosody": {
                "throughSample": 44100,
                "sampleRate": 44100,
                "envelope": [0.1],
                "phase": "speech",
                "accent": 0,
                "leadMs": 0,
                "available": {
                    "startSample": 44100,
                    "stepSamples": 2205,
                    "energy": energy,
                    "finalSample": None,
                },
            },
        }
        validate_activity(activity)
        self.assertAlmostEqual(accent_deadline_ms(activity, 800), 775)
        activity["prosody"]["available"]["energy"][15] = 0.1
        activity["prosody"]["available"]["energy"][3] = 0.8
        self.assertIsNone(accent_deadline_ms(activity, 800))
        activity["speaking"] = False
        self.assertIsNone(accent_deadline_ms(activity, 2000))


if __name__ == "__main__":
    unittest.main()
