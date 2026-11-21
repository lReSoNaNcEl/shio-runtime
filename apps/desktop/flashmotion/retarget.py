"""Normalize the two native releases into world body deltas and local fingers."""

import numpy as np
from scipy.spatial.transform import Rotation, Slerp

BODY_SLOTS = {
    0: 0,
    3: 1,
    6: 2,
    9: 3,
    13: 10,
    16: 11,
    18: 12,
    20: 13,
    14: 16,
    17: 17,
    19: 18,
    21: 19,
    1: 22,
    4: 23,
    7: 24,
    10: 25,
    2: 26,
    5: 27,
    8: 28,
    11: 29,
}
# Native SMPL-X order is index, middle, little, ring, thumb per hand.
FINGERS = (
    37,
    38,
    39,
    *range(25, 31),
    *range(34, 37),
    *range(31, 34),
    52,
    53,
    54,
    *range(40, 46),
    *range(49, 52),
    *range(46, 49),
)
SEGMENTS = {
    3: (6, (0, 1, 0)),
    6: (9, (0, 1, 0)),
    9: (12, (0, 1, 0)),
    13: (16, (1, 0, 0)),
    16: (18, (1, 0, 0)),
    18: (20, (1, 0, 0)),
    14: (17, (-1, 0, 0)),
    17: (19, (-1, 0, 0)),
    19: (21, (-1, 0, 0)),
    1: (4, (0, -1, 0)),
    4: (7, (0, -1, 0)),
    7: (10, (0, 0, 1)),
    2: (5, (0, -1, 0)),
    5: (8, (0, -1, 0)),
    8: (11, (0, 0, 1)),
}


def body_slots(rotations):
    output = np.zeros((len(rotations), 30, 4))
    output[:, :, 3] = 1
    for joint, slot in BODY_SLOTS.items():
        output[:, slot] = rotations[:, joint]
    return output


def t2m_pose(track):
    joints = track["joints"]
    rotations = np.zeros((len(joints), 22, 4))
    rotations[:, :, 3] = 1
    root = track["root_world_to_local_wxyz"][:, [1, 2, 3, 0]].copy()
    rotations[:, 0] = Rotation.from_quat(root).inv().as_quat()
    for joint, (child, rest) in SEGMENTS.items():
        to = joints[:, child] - joints[:, joint]
        to /= np.maximum(1e-9, np.linalg.norm(to, axis=1))[:, None]
        axis = np.cross(rest, to)
        cross = np.linalg.norm(axis, axis=1)
        dot = to @ np.asarray(rest)
        opposed = (cross < 1e-8) & (dot < 0)
        axis[opposed] = np.cross(rest, (0, 0, 1) if rest[2] == 0 else (1, 0, 0))
        axis /= np.maximum(1e-9, np.linalg.norm(axis, axis=1))[:, None]
        angles = np.arctan2(cross, dot)
        rotations[:, joint] = Rotation.from_rotvec(axis * angles[:, None]).as_quat()
    rotations[:, 20] = rotations[:, 18]
    rotations[:, 21] = rotations[:, 19]
    return body_slots(rotations), track["root_metres"]


def s2g_pose(raw, roots, parents):
    local = Rotation.from_rotvec(raw.reshape(-1, 3)).as_matrix().reshape(-1, 55, 3, 3)
    world = local[:, :22].copy()
    for joint in range(1, len(BODY_SLOTS) + 2):
        world[:, joint] = world[:, parents[joint]] @ world[:, joint]
    rotations = (
        Rotation.from_matrix(world.reshape(-1, 3, 3)).as_quat().reshape(-1, 22, 4)
    )
    fingers = raw.reshape(-1, 55, 3)[:, FINGERS]
    angle = np.linalg.norm(fingers, axis=-1, keepdims=True)
    fingers = fingers * np.minimum(1.0, 1.4 / np.maximum(1e-9, angle))
    return (
        body_slots(rotations),
        roots,
        Rotation.from_rotvec(fingers.reshape(-1, 3)).as_quat().reshape(-1, 30, 4),
    )


def resample_t2m(rotations, root, start, frames=60):
    # Reuse one sequence within the exact profile/seed. Reverse at its endpoints.
    period = 2 * (len(rotations) - 1)
    cursor = np.arange(start, start + frames) * (20 / 30) % period
    cursor = np.minimum(cursor, period - cursor)
    source = np.arange(len(rotations))
    arranged = np.stack(
        [
            Slerp(source, Rotation.from_quat(rotations[:, slot]))(cursor).as_quat()
            for slot in range(rotations.shape[1])
        ],
        axis=1,
    )
    roots = np.stack(
        [np.interp(cursor, source, root[:, axis]) for axis in range(3)], axis=1
    )
    return arranged, roots
