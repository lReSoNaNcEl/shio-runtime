"""Bounded geometric pose goals. MotionBricks generates the intervening motion.

Only typed catalog workspace/phase and bounded acoustic metadata are consumed.
This module does not classify text, select conversation intent, or apply VRM pose.
"""

import hashlib

import numpy as np
from activity import accent_deadline_ms
from conversion import world_poses
from scipy.spatial.transform import Rotation


def target_token_count(profile, phase, activity=None):
    """Native endpoint must occur inside the consumed expressive phase.

    SOMA drops three boundary frames at either end: valid = 4*tokens-6.
    Frame zero repeats the context, so endpoint time is (valid-1)/30.
    Presence deliberately retains its previously accepted model policy.
    """
    if profile["kind"] == "presence":
        return None
    milliseconds = next(p["minMs"] for p in profile["phases"] if p["id"] == phase)
    if phase == "stroke":
        milliseconds = accent_deadline_ms(activity, milliseconds) or milliseconds
    return int(np.clip(np.floor((milliseconds * 30 / 1000 + 7) / 4), 6, 16))


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
    def __init__(self, names, parents, standing, workspaces):
        self.names, self.parents, self.standing = names, parents, standing
        self.anchor = world_poses(standing[None], parents)[0]
        self.workspaces = workspaces
        self.reset()

    def reset(self):
        self.goals = {}
        self.variations = {}

    def destinations(self, world, profile, phase, seed, plan):
        execution = (plan or {}).get("executionId", profile["id"])
        identity = (execution, phase)
        if identity in self.goals:
            return self.goals[identity]
        digest = hashlib.sha256(f"{seed}:{execution}:{profile['id']}".encode()).digest()
        rng = np.random.default_rng(int.from_bytes(digest[:8], "little"))
        # One choice per admitted execution, not a new random target at each
        # autoregressive block. The network owns all trajectories between goals.
        variation = self.variations.setdefault(execution, rng.uniform(-0.12, 0.12, 3))
        destinations = {}
        for side in ("left", "right"):
            sign = 1 if side == "left" else -1
            score = profile["handScore"]["phases"][phase][side]
            upper, lower, hand = [
                self.names.index(side.capitalize() + suffix)
                for suffix in ("Arm", "ForeArm", "Hand")
            ]
            shoulder, elbow, wrist = world[-1, [upper, lower, hand], :3]
            length = np.linalg.norm(elbow - shoulder) + np.linalg.norm(wrist - elbow)
            if score["workspace"] == "relaxed":
                # A supporting hand can keep a comfortable attained pose. It
                # need not reset to the same standing reference after every act.
                destinations[side] = wrist.copy()
                continue
            space = self.workspaces[score["workspace"]]
            anchor = {
                "hips": "Hips",
                "chest": "Spine2",
                "neck": "Neck1",
                "head": "Head",
            }[space["anchor"]]
            center = np.array(space["center"]) + np.array(
                score.get("workspaceOffset", [0, 0, 0])
            )
            center *= length
            center[0] *= sign
            center += world[-1, self.names.index(anchor), :3]
            if score["workspace"] == "face":
                # Same ipsilateral shoulder calibration as the Avatar region.
                # A centre below the chin forced this rig's wrist to its limit.
                center[0] = shoulder[0]
            extents = (
                np.array(space["halfExtents"])
                * length
                * score.get("workspaceExtentScale", 1)
            )
            # Deliberately different preparatory and communicative pose goals
            # inside the SAME catalog region. Raising the arm is not the stroke.
            direction = np.array([sign * 0.65, 0.35, 0.35])
            if score["fingerDirection"] == "up":
                direction = np.array([sign * 0.45, 0.7, 0.2])
            # Communicative endpoint preferences, not animation curves. Close
            # profiles can share a physical region without sharing an act.
            semantic = profile["semanticIntent"]
            if semantic == "greeting":
                direction = np.array([sign * 0.9, 0.12, 0.15])
            elif semantic in ("celebrate", "delight"):
                direction = np.array([sign * 0.3, 0.9, 0.15])
            elif semantic == "compare":
                direction = np.array([sign * 0.85, -sign * 0.2, 0.3])
            direction += variation
            stage = -0.85 if phase == "prepare" else 0.85
            target = center + extents * direction * stage
            if phase == "prepare":
                velocity = (world[-1, hand, :3] - world[-2, hand, :3]) * 30
                target += np.clip(velocity * 0.08, -extents * 0.15, extents * 0.15)
            destinations[side] = target
        self.goals[identity] = destinations
        # Forecast/replan can revisit an exact phase; retain bounded identities.
        while len(self.goals) > 12:
            del self.goals[next(iter(self.goals))]
        while len(self.variations) > 6:
            del self.variations[next(iter(self.variations))]
        return destinations

    def goal(self, history, profile, phase, seed, activity, plan=None):
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
        destinations = self.destinations(world, profile, phase, seed, plan)
        for side in ("left", "right"):
            sign = 1 if side == "left" else -1
            upper, lower, hand = [
                self.names.index(side.capitalize() + suffix)
                for suffix in ("Arm", "ForeArm", "Hand")
            ]
            shoulder, elbow, wrist = current[[upper, lower, hand], :3]
            zone = score[side]["workspace"]
            length1, length2 = (
                np.linalg.norm(elbow - shoulder),
                np.linalg.norm(wrist - elbow),
            )
            scale = (length1 + length2) / 0.60
            if zone == "relaxed":
                target = (
                    wrist * 0.75 + self.anchor[hand, :3] * 0.25
                    if profile["kind"] == "presence"
                    else destinations[side].copy()
                )
            else:
                target = destinations[side].copy()
                prosody = (activity or {}).get("prosody")
                if phase == "stroke" and prosody and prosody["leadMs"] <= 250:
                    # A fresh consumed accent modulates the existing semantic
                    # goal only. No extrapolated beat or late accent is queued.
                    space = self.workspaces[zone]
                    extent = (
                        np.array(space["halfExtents"])
                        * (length1 + length2)
                        * score[side].get("workspaceExtentScale", 1)
                    )
                    target += (
                        extent * np.array([sign * 0.15, 0.2, 0.1]) * prosody["accent"]
                    )
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
            if profile["kind"] == "presence":
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
