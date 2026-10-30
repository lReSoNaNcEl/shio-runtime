"""Deterministic planner/protocol checks; no models, GPU, or cached assets."""

import copy
import json
import unittest
from pathlib import Path

import numpy as np
from activity import accent_deadline_ms, available_accents, validate_activity
from conversion import world_poses
from scipy.spatial.transform import Rotation
from targets import TargetPlanner, endpoint_ms, target_token_count


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

    def talking(self, style=None, energy=0.15):
        activity = {
            "energy": energy,
            "playbackId": "a",
            "speaking": True,
            "prosody": {
                "throughSample": 4410,
                "sampleRate": 44100,
                "envelope": [energy],
                "phase": "speech",
                "accent": 0,
                "leadMs": 0,
            },
        }
        if style is not None:
            activity["style"] = style
        return activity

    def style(self, **axes):
        neutral = {
            "openness": 0.5,
            "height": 0.5,
            "tempo": 0.5,
            "sharpness": 0.5,
            "asymmetry": 0.5,
            "lean": 0.0,
        }
        return {**neutral, **axes}

    def mean_hand(self, activity, side="Right", seeds=range(60, 80)):
        planner = TargetPlanner(
            self.names, self.parents, self.standing, self.catalog["handWorkspaces"]
        )
        profile = self.profile("presence_speaking")
        return np.mean(
            [
                self.hand(
                    planner.goal(self.history, profile, "hold", seed, activity), side
                )
                for seed in seeds
            ],
            axis=0,
        )

    def test_neutral_style_reproduces_unstyled_speech_goals_exactly(self):
        profile = self.profile("presence_speaking")
        plain, styled = (
            TargetPlanner(
                self.names, self.parents, self.standing, self.catalog["handWorkspaces"]
            )
            for _ in range(2)
        )
        for seed in range(40, 52):
            np.testing.assert_array_equal(
                plain.goal(self.history, profile, "hold", seed, self.talking()),
                styled.goal(
                    self.history, profile, "hold", seed, self.talking(self.style())
                ),
            )

    def test_height_raises_and_openness_widens_conversational_hands(self):
        low = self.mean_hand(self.talking(self.style(height=0.1)))
        high = self.mean_hand(self.talking(self.style(height=0.9)))
        self.assertGreater(high[1] - low[1], 0.03)
        narrow = self.mean_hand(self.talking(self.style(openness=0.1)))
        wide = self.mean_hand(self.talking(self.style(openness=0.9)))
        # The right hand moves toward negative x when it opens laterally.
        self.assertGreater(narrow[0] - wide[0], 0.02)

    def test_tempo_bounds_native_beat_blocks(self):
        profile = self.profile("presence_speaking")
        counts = [
            target_token_count(profile, "hold", self.talking(self.style(tempo=tempo)))
            for tempo in (0, 0.25, 0.5, 0.75, 1)
        ]
        self.assertEqual(counts[2], 7)
        self.assertEqual(counts, sorted(counts, reverse=True))
        self.assertTrue(all(6 <= count <= 9 for count in counts))
        self.assertGreater(counts[0], counts[-1])

    def test_styled_goals_are_deterministic_by_seed(self):
        activity = self.talking(self.style(openness=0.8, sharpness=0.9, lean=0.6))
        profile = self.profile("presence_speaking")
        goals = []
        for _ in range(2):
            planner = TargetPlanner(
                self.names, self.parents, self.standing, self.catalog["handWorkspaces"]
            )
            goals.append(
                [
                    planner.goal(self.history, profile, "hold", s, activity)
                    for s in (3, 4)
                ]
            )
        np.testing.assert_array_equal(goals[0], goals[1])

    def test_style_validation_rejects_unknown_axes_and_out_of_range_values(self):
        self.assertEqual(
            validate_activity(self.talking(self.style()))["style"], self.style()
        )
        for bad in (
            {**self.style(), "extra": 0.1},
            {k: v for k, v in self.style().items() if k != "tempo"},
            self.style(openness=1.2),
            self.style(lean=-1.5),
            self.style(height=float("nan")),
            self.style(tempo=True),
            "calm",
        ):
            with self.assertRaises(ValueError):
                validate_activity(self.talking(bad))

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

    def pitch_activity(self, accent_bin=None, final=None, value=0.7):
        accents = [0.0] * 30
        if accent_bin is not None:
            accents[accent_bin] = value
        return {
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
                    "energy": [0.1] * 30,
                    "accent": accents,
                    "finalSample": final,
                },
            },
        }

    def test_talking_beat_endpoint_lands_on_an_available_pitch_accent(self):
        profile = self.profile("presence_speaking")
        # Bin centre (i + 0.5) * 50 ms after the consumed origin.
        for accent_bin in (12, 14, 16, 18):
            activity = self.pitch_activity(accent_bin)
            validate_activity(activity)
            tokens = target_token_count(profile, "hold", activity)
            accent_ms = (accent_bin + 0.5) * 50
            self.assertLessEqual(abs(endpoint_ms(tokens) - accent_ms), 120)
            self.assertTrue(6 <= tokens <= 9)
        self.assertEqual(target_token_count(profile, "hold", self.pitch_activity()), 7)

    def test_beat_accents_respect_the_native_minimum_and_final_sample(self):
        profile = self.profile("presence_speaking")
        early = self.pitch_activity(8)
        self.assertEqual(target_token_count(profile, "hold", early), 7)
        self.assertEqual(available_accents(early, 0, 2000), [])
        beyond_final = self.pitch_activity(16, final=44100 + 2205 * 14)
        self.assertEqual(target_token_count(profile, "hold", beyond_final), 7)
        weak = self.pitch_activity(16, value=0.1)
        self.assertEqual(available_accents(weak, 0, 2000), [])

    def test_stroke_deadline_accepts_pitch_accents_and_validates_alignment(self):
        activity = self.pitch_activity(15)
        self.assertAlmostEqual(accent_deadline_ms(activity, 800), 775)
        for bad in ([0.1] * 29, [1.5] + [0.0] * 29, "accent"):
            broken = copy.deepcopy(activity)
            broken["prosody"]["available"]["accent"] = bad
            with self.assertRaises(ValueError):
                validate_activity(broken)


if __name__ == "__main__":
    unittest.main()
