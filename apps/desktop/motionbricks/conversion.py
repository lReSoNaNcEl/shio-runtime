"""SOMA local bind transforms to the existing Y-up world-delta contract."""

import numpy as np
from scipy.spatial.transform import Rotation


def world_poses(local: np.ndarray, parents: np.ndarray) -> np.ndarray:
    world = local.copy().astype(np.float64)
    for joint, parent in enumerate(parents):
        if parent >= 0:
            rotation = Rotation.from_quat(world[:, parent, 3:])
            world[:, joint, :3] = world[:, parent, :3] + rotation.apply(
                local[:, joint, :3]
            )
            world[:, joint, 3:] = (
                rotation * Rotation.from_quat(local[:, joint, 3:])
            ).as_quat()
    return world


def canonical_rotations(local, parents, reference_world, indices):
    world = world_poses(local, parents)
    deltas = np.empty((len(local), len(indices), 4), dtype=np.float64)
    for index, joint in enumerate(indices):
        deltas[:, index] = (
            Rotation.from_quat(world[:, joint, 3:])
            * Rotation.from_quat(reference_world[joint, 3:]).inv()
        ).as_quat()
    if not np.isfinite(deltas).all():
        raise ValueError("Non-finite canonical rotations")
    return world, deltas
