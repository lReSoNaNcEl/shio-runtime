"""Offline-derived standing reference, never a clip player or BVH dependency."""

import hashlib
import json
from pathlib import Path

import numpy as np
from conversion import world_poses
from scipy.spatial.transform import Rotation

ASSET = Path(__file__).resolve().parent / "assets/standing-pose.soma.json"
CALIBRATION = "vrma-soma-standing-v1"
MAPPING = {
    "hips": "Hips",
    "spine": "Spine1",
    "chest": "Spine2",
    "upperChest": "Chest",
    "leftShoulder": "LeftShoulder",
    "leftUpperArm": "LeftArm",
    "leftLowerArm": "LeftForeArm",
    "leftHand": "LeftHand",
    "rightShoulder": "RightShoulder",
    "rightUpperArm": "RightArm",
    "rightLowerArm": "RightForeArm",
    "rightHand": "RightHand",
    "leftUpperLeg": "LeftLeg",
    "leftLowerLeg": "LeftShin",
    "leftFoot": "LeftFoot",
    "leftToes": "LeftToeBase",
    "rightUpperLeg": "RightLeg",
    "rightLowerLeg": "RightShin",
    "rightFoot": "RightFoot",
    "rightToes": "RightToeBase",
}


def reference_digest(reference):
    return hashlib.sha256(np.asarray(reference, dtype="<f4").tobytes()).hexdigest()


def apply_deltas(reference, parents, names, deltas):
    """World-space normalized VRM deltas precede SOMA world bind orientation.

    Bone lengths remain SOMA-owned; unmapped head/finger joints retain their
    local bind transforms. No source translation or model scale is imported.
    """
    reference_world = world_poses(reference[None], parents)[0]
    result = reference.copy().astype(np.float64)
    rotations = []
    for index, (name, parent) in enumerate(zip(names, parents)):
        parent_rotation = rotations[parent] if parent >= 0 else Rotation.identity()
        if name in deltas:
            target = Rotation.from_quat(deltas[name]) * Rotation.from_quat(
                reference_world[index, 3:]
            )
            result[index, 3:] = (parent_rotation.inv() * target).as_quat()
        rotations.append(parent_rotation * Rotation.from_quat(result[index, 3:]))
    return result


def support_metrics(pose, parents, names):
    world = world_poses(pose[None], parents)[0]
    left, right = (world[names.index(side + "ToeBase"), :3] for side in ("Left", "Right"))
    hips = world[names.index("Hips"), :3]
    hands = [world[names.index(side + "Hand"), :3] for side in ("Left", "Right")]
    return {
        "footHeightDifferenceM": float(abs(left[1] - right[1])),
        "supportWidthM": float(abs(left[0] - right[0])),
        "hipsAboveSupportM": float(hips[1] - min(left[1], right[1])),
        "hipsLateralOffsetM": float(abs(hips[0] - (left[0] + right[0]) / 2)),
        "highestHandAboveHipsM": float(max(hand[1] - hips[1] for hand in hands)),
    }


def load_standing_pose(reference, parents, names, path=ASSET):
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if (
        value.get("calibrationVersion") != CALIBRATION
        or value.get("skeletonIdentity") != "soma30-standard-tpose-v1"
        or value.get("jointNames") != list(names)
        or value.get("parents") != [int(parent) for parent in parents]
        or value.get("referenceSha256") != reference_digest(reference)
        or set(value.get("worldDeltas", {})) != set(MAPPING.values())
    ):
        raise ValueError("Incompatible standing pose identity")
    quaternions = np.asarray(list(value["worldDeltas"].values()), dtype=np.float64)
    if (
        quaternions.shape != (len(MAPPING), 4)
        or not np.isfinite(quaternions).all()
        or not np.allclose(np.linalg.norm(quaternions, axis=1), 1, atol=1e-5)
    ):
        raise ValueError("Invalid standing pose rotations")
    height = value.get("rootHeightM")
    if type(height) not in (float, int) or not np.isfinite(height) or not 0.7 < height < 1.3:
        raise ValueError("Invalid standing pose support height")
    pose = apply_deltas(reference, parents, names, value["worldDeltas"])
    pose[0, :3] = [0, height, 0]
    metrics = support_metrics(pose, parents, names)
    if (
        metrics["footHeightDifferenceM"] > 0.04
        or not 0.08 < metrics["supportWidthM"] < 0.5
        or metrics["hipsLateralOffsetM"] > 0.04
        or metrics["highestHandAboveHipsM"] > 0.15
    ):
        raise ValueError("Standing pose fails support qualification")
    return pose.astype(np.float32)
