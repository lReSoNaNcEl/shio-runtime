"""Bounded geometric pose goals. MotionBricks generates the intervening motion.

Only typed catalog workspace/phase and bounded acoustic metadata are consumed.
This module does not classify text, select conversation intent, or apply VRM pose.
"""

import numpy as np
from conversion import world_poses
from scipy.spatial.transform import Rotation


def between(source, target):
    a = source / max(np.linalg.norm(source), 1e-10)
    b = target / max(np.linalg.norm(target), 1e-10)
    dot = float(np.clip(a @ b, -1, 1))
    if dot < -0.999999:
        axis = np.cross(a, np.eye(3)[np.argmin(np.abs(a))])
        return Rotation.from_rotvec(axis / np.linalg.norm(axis) * np.pi)
    quaternion = np.r_[np.cross(a, b), 1 + dot]
    return Rotation.from_quat(quaternion / np.linalg.norm(quaternion))


class TargetPlanner:
    def __init__(self, names, parents, standing):
        self.names, self.parents, self.standing = names, parents, standing
        self.anchor = world_poses(standing[None], parents)[0]

    def goal(self, history, profile, phase, seed, activity):
        goal = history[-1].copy()
        world = world_poses(history, self.parents)
        current = world[-1]
        goal[0] = self.standing[0]
        for name in (
            "LeftLeg",
            "LeftShin",
            "LeftFoot",
            "LeftToeBase",
            "RightLeg",
            "RightShin",
            "RightFoot",
            "RightToeBase",
        ):
            joint = self.names.index(name)
            goal[joint] = self.standing[joint]
        score = profile["handScore"]["phases"][phase]
        rng = np.random.default_rng(seed)
        amplitude = float(rng.uniform(0.90, 1.02))
        for side in ("left", "right"):
            sign = 1 if side == "left" else -1
            upper, lower, hand = [
                self.names.index(side.capitalize() + suffix)
                for suffix in ("Arm", "ForeArm", "Hand")
            ]
            shoulder, elbow, wrist = current[[upper, lower, hand], :3]
            zone = score[side]["workspace"]
            # These are a few bounded pose goals, not stored animation curves.
            offsets = {
                "front": [sign * 0.04, -0.24, 0.32],
                "raised": [sign * 0.12, 0.12, 0.22],
                "heart": [-sign * 0.12, -0.12, 0.20],
                "side": [sign * 0.36, -0.10, 0.10],
                "waist": [-sign * 0.10, -0.36, 0.15],
                "face": [-sign * 0.04, 0.03, 0.20],
            }
            length1, length2 = (
                np.linalg.norm(elbow - shoulder),
                np.linalg.norm(wrist - elbow),
            )
            scale = (length1 + length2) / 0.60
            if zone == "relaxed":
                target = wrist * 0.75 + self.anchor[hand, :3] * 0.25
            else:
                target = shoulder + np.array(offsets[zone]) * scale * amplitude
                if phase == "prepare":
                    target = wrist + (target - wrist) * 0.55
            if profile["kind"] == "presence":
                if activity and activity["speaking"] and activity["energy"] > 0.025:
                    energy = activity["energy"]
                    variation = float(rng.uniform(-1, 1))
                    target += (
                        np.array(
                            [
                                sign * variation * 0.01,
                                0.015 * energy,
                                0.02 + 0.04 * energy,
                            ]
                        )
                        * scale
                    )
                else:
                    target = wrist * 0.9 + target * 0.1
            velocity = (world[-1, hand, :3] - world[-2, hand, :3]) * 30
            target += np.clip(velocity * 0.08, -0.02 * scale, 0.02 * scale)
            vector = target - shoulder
            distance = float(
                np.clip(
                    np.linalg.norm(vector),
                    abs(length1 - length2) + 0.02 * scale,
                    (length1 + length2) * 0.97,
                )
            )
            direction = vector / max(np.linalg.norm(vector), 1e-10)
            target = shoulder + direction * distance
            along = (length1**2 - length2**2 + distance**2) / (2 * distance)
            pole = elbow - shoulder
            pole -= direction * float(pole @ direction)
            if np.linalg.norm(pole) < 0.03 * scale:
                pole = np.array([sign * 0.5, -0.8, -0.1])
                pole -= direction * float(pole @ direction)
            pole /= max(np.linalg.norm(pole), 1e-10)
            desired_elbow = (
                shoulder
                + direction * along
                + pole * np.sqrt(max(0, length1**2 - along**2))
            )
            upper_world = between(
                elbow - shoulder, desired_elbow - shoulder
            ) * Rotation.from_quat(current[upper, 3:])
            parent = self.parents[upper]
            parent_world = (
                Rotation.from_quat(current[parent, 3:])
                if parent >= 0
                else Rotation.identity()
            )
            goal[upper, 3:] = (parent_world.inv() * upper_world).as_quat()
            after_upper = world_poses(goal[None], self.parents)[0]
            lower_world = between(
                after_upper[hand, :3] - after_upper[lower, :3],
                target - after_upper[lower, :3],
            ) * Rotation.from_quat(after_upper[lower, 3:])
            goal[lower, 3:] = (upper_world.inv() * lower_world).as_quat()
        if not np.isfinite(goal).all():
            raise ValueError("Invalid bounded pose goal")
        return goal
