"""Bounded geometric pose goals. MotionBricks generates the intervening motion.

Only typed catalog workspace/phase and bounded acoustic metadata are consumed.
This module does not classify text, select conversation intent, or apply VRM pose.
"""

import hashlib

import numpy as np
from activity import accent_deadline_ms
from conversion import world_poses
from scipy.spatial.transform import Rotation

# Hips-anchored conversational base in arm lengths (lateral, up, forward):
# forearms forward with both hands in front of the lower torso. While consumed
# speech is active, presence moves from this base instead of from hands
# hanging beside the hips. Beats are non-semantic speech-rhythm displacements.
TALK_BASE = np.array([0.22, 0.30, 0.42])
# Beat shapes (lateral, up, forward), in arm lengths: an opening of the palm
# outward, a lift, and a forward press. One is chosen per beat, never per word.
TALK_BEATS = {
    "open": np.array([0.13, 0.08, 0.05]),
    "lift": np.array([0.05, 0.2, 0.1]),
    "press": np.array([0.06, -0.05, 0.16]),
}
TALK_SETTLE = np.array([-0.03, -0.06, -0.03])
TALK_SUPPORT = 0.3
# Shorter native blocks while talking: one beat or settle per ~0.7 s instead
# of the default 0.9–1.7 s, so beats follow conversational rhythm.
TALK_TOKENS = 7
# Upper-body turn toward the acting hand (radians, about world up) and a small
# forward lean on press beats, distributed over the spine chain.
TORSO_JOINTS = (("Spine1", 0.3), ("Spine2", 0.35), ("Chest", 0.35))
TALK_TORSO_YAW = 0.11
TALK_LEAD_PERSISTENCE = 0.6
GESTURE_TORSO_YAW = 0.12
PRESS_LEAN = 0.06


def speech_intensity(activity):
    """Bounded beat amplitude from consumed speech metadata; pause is zero."""
    prosody = activity.get("prosody") or {}
    if prosody.get("phase") == "pause":
        return 0.0
    envelope = prosody.get("envelope") or [activity["energy"]]
    level = max(activity["energy"], float(np.mean(envelope)))
    return float(np.clip((level - 0.02) / 0.15, 0.35, 1.0))


def target_token_count(profile, phase, activity=None):
    """Native endpoint must occur inside the consumed expressive phase.

    SOMA drops three boundary frames at either end: valid = 4*tokens-6.
    Frame zero repeats the context, so endpoint time is (valid-1)/30.
    Quiet presence deliberately retains its previously accepted model policy.
    """
    if profile["kind"] == "presence":
        return TALK_TOKENS if activity and activity["speaking"] else None
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
        self.beat = 0
        self.beat_lead = "right"
        self.beat_shape = "open"

    def torso_turn(self, profile, phase, score, talking, activity):
        """Upper-body (yaw, lean) toward the acting hand, or None to keep the
        network's own torso. Positive yaw turns toward the character's left."""
        if talking:
            intensity = speech_intensity(activity)
            sign = {"left": 1, "right": -1}.get(self.beat_lead, 0)
            out = self.beat % 2 == 1
            yaw = sign * TALK_TORSO_YAW * intensity * (1.0 if out else 0.4)
            lean = PRESS_LEAN * intensity if out and self.beat_shape == "press" else 0.0
            return yaw, lean
        if profile["kind"] == "gesture" and phase in ("prepare", "stroke", "hold"):
            leads = [
                side for side in ("left", "right") if score[side]["role"] == "lead"
            ]
            if len(leads) == 1:
                sign = 1 if leads[0] == "left" else -1
                return sign * GESTURE_TORSO_YAW * (
                    0.6 if phase == "prepare" else 1.0
                ), 0.0
        return None

    def talk_target(self, current, side, length, activity, out, rng):
        """Conversational presence goal for one hand during consumed speech.

        Alternate autoregressive blocks move the beat hand out from the base
        and settle it back, so the network owns every trajectory in between.
        """
        sign = 1 if side == "left" else -1
        hips = current[self.names.index("Hips"), :3]
        offset = TALK_BASE * length
        offset[0] *= sign
        target = hips + offset
        intensity = speech_intensity(activity)
        mirror = np.array([sign, 1, 1])
        if out and intensity > 0:
            share = (
                0.75
                if self.beat_lead == "both"
                else 1.0
                if self.beat_lead == side
                else TALK_SUPPORT
            )
            beat = TALK_BEATS[self.beat_shape] * length * mirror
            target += beat * intensity * share * rng.uniform(0.8, 1.2)
        else:
            settle = TALK_SETTLE * length * mirror * (1 - 0.4 * intensity)
            target += settle + rng.uniform(-0.02, 0.02, 3) * length
        return target

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
        talking = profile["kind"] == "presence" and bool(
            activity and activity["speaking"]
        )
        if talking:
            self.beat += 1
            if self.beat % 2 == 1:
                # A speaker favours one side for a few beats; the lead (and the
                # torso turn that follows it) does not swivel every beat.
                if self.beat_lead == "both" or rng.random() >= TALK_LEAD_PERSISTENCE:
                    self.beat_lead = str(
                        rng.choice(["right", "left", "both"], p=[0.45, 0.35, 0.2])
                    )
                self.beat_shape = str(rng.choice(list(TALK_BEATS), p=[0.4, 0.35, 0.25]))
        else:
            self.beat = 0
        turn = self.torso_turn(profile, phase, score, talking, activity)
        if turn is not None:
            # The network turns the upper body toward the acting hand. Goals are
            # relative to standing, so consecutive blocks never accumulate yaw.
            yaw, lean = turn
            for name, share in TORSO_JOINTS:
                joint = self.names.index(name)
                rotation = Rotation.from_rotvec([lean * share, yaw * share, 0.0])
                goal[joint, 3:] = (
                    rotation * Rotation.from_quat(self.standing[joint, 3:])
                ).as_quat()
            # Arm goals are solved from the turned shoulders.
            current = world_poses(goal[None], self.parents)[0]
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
            if talking:
                target = self.talk_target(
                    current, side, length1 + length2, activity, self.beat % 2 == 1, rng
                )
            elif profile["kind"] == "presence":
                rest = self.anchor[hand, :3]
                if np.linalg.norm(wrist - rest) > 0.07 * scale:
                    # Speech ended with raised conversational hands: settle
                    # back over a few blocks instead of a 2.5%-per-block drift.
                    target = wrist + (rest - wrist) * 0.5
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
