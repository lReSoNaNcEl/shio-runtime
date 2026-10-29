"""Read pinned main Git blobs offline and derive one SOMA reference pose.

Run with the MotionBricks Python environment from the repository root. This
script does not copy VRMA clips, read evaluation BVH, or start inference.
"""

import hashlib
import json
import os
import struct
import subprocess
import sys
from pathlib import Path

import numpy as np
from conversion import world_poses
from scipy.spatial.transform import Rotation
from standing_pose import (
    ASSET,
    CALIBRATION,
    MAPPING,
    apply_deltas,
    reference_digest,
    support_metrics,
)

ROOT = Path(__file__).resolve().parent
REVISION = "39310f0d7a17616c30e2becdeeda845670353320"
CANDIDATES = ("neutral_idle", "neutral4", "breathing_idle", "happy_idle")


def read_vrma(name):
    path = f"apps/desktop/src/renderer/assets/vrma/{name}.vrma"
    blob = subprocess.check_output(["git", "show", f"{REVISION}:{path}"], cwd=ROOT)
    magic, version, total, length, kind = struct.unpack_from("<5I", blob)
    if magic != 0x46546C67 or version != 2 or total != len(blob) or kind != 0x4E4F534A:
        raise ValueError("Invalid GLB container")
    document = json.loads(blob[20 : 20 + length])
    binary_length, binary_kind = struct.unpack_from("<2I", blob, 20 + length)
    if binary_kind != 0x004E4942:
        raise ValueError("VRMA requires an embedded binary buffer")
    binary = blob[28 + length : 28 + length + binary_length]
    mapping = document["extensions"]["VRMC_vrm_animation"]["humanoid"]["humanBones"]
    if not set(MAPPING).issubset(mapping):
        raise ValueError("Incomplete humanoid mapping")
    if len({item["node"] for item in mapping.values()}) != len(mapping):
        raise ValueError("Aliased humanoid mapping")

    def accessor(index):
        entry = document["accessors"][index]
        if entry["componentType"] != 5126 or "sparse" in entry:
            raise ValueError("Unsupported source accessor")
        view = document["bufferViews"][entry["bufferView"]]
        width = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[entry["type"]]
        offset = view.get("byteOffset", 0) + entry.get("byteOffset", 0)
        return np.ndarray(
            (entry["count"], width),
            dtype="<f4",
            buffer=binary,
            offset=offset,
            strides=(view.get("byteStride", width * 4), 4),
        ).copy()

    nodes = document["nodes"]
    parents = [-1] * len(nodes)
    for index, node in enumerate(nodes):
        for child in node.get("children", []):
            parents[child] = index
    rest = np.array([node.get("rotation", [0, 0, 0, 1]) for node in nodes], dtype=np.float64)

    def worlds(local):
        result = [None] * len(nodes)

        def visit(index):
            if result[index] is None:
                rotation = Rotation.from_quat(local[index])
                result[index] = (
                    visit(parents[index]) * rotation if parents[index] >= 0 else rotation
                )
            return result[index]

        return [visit(index) for index in range(len(nodes))]

    rest_world = worlds(rest)
    animation = document["animations"][0]
    tracks = []
    for channel in animation["channels"]:
        if channel["target"]["path"] != "rotation":
            continue
        sampler = animation["samplers"][channel["sampler"]]
        if sampler.get("interpolation", "LINEAR") != "LINEAR":
            raise ValueError("Unsupported source interpolation")
        tracks.append(
            (
                channel["target"]["node"],
                accessor(sampler["input"])[:, 0],
                accessor(sampler["output"]),
            )
        )
    # Exact common sample times avoid introducing a second interpolator.
    times = tracks[0][1]
    if any(not np.array_equal(times, track[1]) for track in tracks):
        raise ValueError("Source rotation tracks do not share sample times")
    frames = []
    for frame, timestamp in enumerate(times):
        local = rest.copy()
        for index, _, rotations in tracks:
            local[index] = rotations[frame]
        world = worlds(local)
        deltas = {
            soma: (world[mapping[human]["node"]] * rest_world[mapping[human]["node"]].inv())
            .as_quat()
            .tolist()
            for human, soma in MAPPING.items()
        }
        frames.append((float(timestamp), deltas))
    return path, hashlib.sha256(blob).hexdigest(), document.get("asset", {}), frames


def main():
    os.environ["WARP_CACHE_PATH"] = str(ROOT / ".warp-cache")
    sys.path.insert(0, str(ROOT / ".cache/upstream"))
    from motionbricks.io.usd import load_skeleton_from_usd
    from motionbricks.io.utils import SOMA_SKELETON_PRIM_PATH, get_asset_file

    rig = load_skeleton_from_usd(
        get_asset_file("human", "soma_base_skel_minimal_no_root.usd"), SOMA_SKELETON_PRIM_PATH
    )
    reference, parents, names = (
        rig.reference_local_transforms.numpy(),
        rig.parent_indices.numpy(),
        rig.joint_names,
    )
    candidates = []
    for name in CANDIDATES:
        path, digest, metadata, frames = read_vrma(name)
        previous = None
        best = None
        for timestamp, deltas in frames:
            pose = apply_deltas(reference, parents, names, deltas)
            metrics = support_metrics(pose, parents, names)
            world = world_poses(pose[None], parents)[0]
            speed = (
                float(np.linalg.norm(world[:, :3] - previous[1]) / (timestamp - previous[0]))
                if previous is not None
                else 100
            )
            previous = (timestamp, world[:, :3])
            if timestamp < 0.2 or timestamp > frames[-1][0] - 0.2:
                continue
            if (
                metrics["footHeightDifferenceM"] > 0.04
                or metrics["highestHandAboveHipsM"] > 0.15
                or metrics["hipsLateralOffsetM"] > 0.04
                or not 0.08 < metrics["supportWidthM"] < 0.5
            ):
                continue
            score = speed + metrics["footHeightDifferenceM"] * 5 + metrics["hipsLateralOffsetM"]
            if best is None or score < best[0]:
                best = (score, timestamp, deltas, pose, metrics)
        print(
            json.dumps(
                {
                    "candidate": name,
                    "samples": len(frames),
                    "accepted": best is not None,
                    "best": None
                    if best is None
                    else {"score": best[0], "timestamp": best[1], **best[4]},
                }
            )
        )
        if best:
            candidates.append((best[0], path, digest, metadata, best))
    if not candidates:
        raise ValueError("No candidate passed standing support qualification")
    _, path, digest, metadata, (_, timestamp, deltas, pose, metrics) = min(
        candidates, key=lambda candidate: candidate[0]
    )
    world = world_poses(pose[None], parents)[0]
    support = min(
        world[names.index(side + joint), 1]
        for side in ("Left", "Right")
        for joint in ("ToeBase", "ToeEnd")
    )
    value = {
        "calibrationVersion": CALIBRATION,
        "skeletonIdentity": "soma30-standard-tpose-v1",
        "source": {
            "branch": "main",
            "gitRevision": REVISION,
            "path": path,
            "sha256": digest,
            "sampledTimestampSeconds": timestamp,
            "metadata": metadata,
            "rightsStatus": "Repository provenance verified; original author/license not documented in source metadata. No redistribution license inferred.",
        },
        "method": "VRMA world rotation * inverse rest world; normalized Y-up world delta * SOMA world bind; preserve SOMA lengths; root X/Z zero; lowest toe on floor. No source translation, fingers, head or face.",
        "jointNames": list(names),
        "parents": [int(parent) for parent in parents],
        "referenceSha256": reference_digest(reference),
        "rootHeightM": float(pose[0, 1] - support),
        "worldDeltas": deltas,
        "supportMetrics": metrics,
    }
    ASSET.parent.mkdir(parents=True, exist_ok=True)
    ASSET.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
