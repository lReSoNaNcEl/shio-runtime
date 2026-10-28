"""Native SOMA-X prior projection, not a text/audio-to-hand generative model."""

import hashlib
import json
from pathlib import Path

import numpy as np
from pxr import Usd, UsdSkel
from scipy.spatial.transform import Rotation

MODEL = "233e9225c1da05c6a3dd98107b9f027f2366e3b972bbe67e0d164e5d28619fff"
SELECTED = [1, 2, 3, 6, 7, 8, 11, 12, 13, 16, 17, 18, 21, 22, 23]
FINGERS = ("thumb", "index", "middle", "ring", "little")


class HandPrior:
    def __init__(self, root: Path):
        asset = root / "SOMAHand.npz"
        with asset.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != MODEL:
                raise ValueError("Unqualified SOMA-X Hand prior")
        self.sides = {}
        template = root / "SOMA_template_rig.usda"
        with template.open("rb") as stream:
            if (
                hashlib.file_digest(stream, "sha256").hexdigest()
                != "a952cb7bdf4ccd801e355d53122d395b985b69d0d9181439edad5081bb171856"
            ):
                raise ValueError("Unqualified SOMA-X hand template")
        stage = Usd.Stage.Open(str(template))
        rigs = [
            UsdSkel.Skeleton(prim)
            for prim in stage.Traverse()
            if prim.IsA(UsdSkel.Skeleton)
        ]
        if len(rigs) != 1:
            raise ValueError("Ambiguous SOMA hand reference rig")
        names = [str(name).rsplit("/", 1)[-1] for name in rigs[0].GetJointsAttr().Get()]
        bind = np.asarray(rigs[0].GetBindTransformsAttr().Get()).transpose(0, 2, 1)
        with np.load(asset, allow_pickle=False) as data:
            metadata = json.loads(data["pose_pca_metadata"].item())
            if metadata.get("rotation_repr") != "expmap" or not metadata.get(
                "identity_at_bind_pose"
            ):
                raise ValueError("Incompatible SOMA-X prior convention")
            for side in ("left", "right"):
                prefix = side + "_pose_"
                prior = {
                    key: np.asarray(data[prefix + key], dtype=np.float64)
                    for key in (
                        "mean",
                        "components",
                        "eigenvalues",
                        "reference_orient",
                        "reference_orient_parent",
                    )
                }
                if prior["components"].shape != (32, 72) or prior["mean"].shape != (
                    24,
                    3,
                ):
                    raise ValueError("Invalid SOMA-X articulation dimensions")
                parents = data[prefix + "reference_parent_ids"].astype(int)
                ids = [
                    names.index(str(name))
                    for name in data[prefix + "reference_joint_names"]
                ]
                positions = bind[ids, :3, 3].astype(np.float64)
                wrist_orientation = bind[ids[0], :3, :3]
                if not np.allclose(
                    wrist_orientation.T @ bind[ids, :3, :3],
                    prior["reference_orient"],
                    atol=1e-5,
                ):
                    raise ValueError("SOMA prior and template bind rotations disagree")
                positions = (positions - positions[0]) @ wrist_orientation
                across = positions[5] - positions[20]
                across /= np.linalg.norm(across)
                along = positions[10].copy()
                along -= across * np.dot(along, across)
                along /= np.linalg.norm(along)
                prior["basis"] = Rotation.from_matrix(
                    np.stack((across, along, np.cross(across, along)), axis=-1)
                ).as_quat()
                prior["parents"] = parents
                prior["deviations"] = np.sqrt(np.maximum(prior["eigenvalues"], 1e-12))
                self.sides[side] = prior
        self.reset()

    def reset(self):
        self.history = {
            side: {index: np.zeros(32) for index in range(-4, 0)} for side in self.sides
        }

    def target_coefficients(self, side, score):
        prior = self.sides[side]
        target = prior["mean"].copy()
        groups = ((0, 3), (5, 8), (10, 13), (15, 18), (20, 23))
        for finger, (start, end) in zip(FINGERS, groups):
            curls = score["fingers"][finger]["curl"]
            for order, joint in enumerate(range(start, end)):
                direction = prior["mean"][joint]
                norm = np.linalg.norm(direction)
                if norm > 1e-5:
                    target[joint] = direction / norm * float(curls[min(order, 2)])
        coefficients = (
            (target - prior["mean"]).reshape(-1) @ prior["components"].T
        ) / prior["deviations"]
        return np.clip(coefficients, -1.5, 1.5)

    def decode(self, side, coefficients):
        prior = self.sides[side]
        expmap = (
            prior["mean"].reshape(-1)
            + (coefficients * prior["deviations"]) @ prior["components"]
        )
        relative = np.tile(np.eye(3), (len(coefficients), 25, 1, 1))
        relative[:, 1:] = (
            Rotation.from_rotvec(expmap.reshape(-1, 3))
            .as_matrix()
            .reshape(-1, 24, 3, 3)
        )
        # Exactly the official bind-relative -> absolute-local conversion. The
        # wrist has no coefficients and receives identity, never body motion.
        local = (
            prior["reference_orient_parent"].swapaxes(-2, -1)
            @ relative
            @ prior["reference_orient"]
        )
        world = local.copy()
        for joint, parent in enumerate(prior["parents"]):
            if parent >= 0:
                world[:, joint] = world[:, parent] @ local[:, joint]
        delta = world @ prior["reference_orient"].swapaxes(-2, -1)
        return (
            Rotation.from_matrix(delta[:, SELECTED].reshape(-1, 3, 3))
            .as_quat()
            .reshape(-1, 15, 4)
        )

    def generate(self, frame, score):
        sides = []
        for side in self.sides:
            if frame - 1 not in self.history[side]:
                raise ValueError("Unavailable exact hand history")
            current = self.history[side][frame - 1]
            target = self.target_coefficients(side, score[side])
            # Temporal articulation is application-authored, separate from the
            # statistical prior. One body/source clock samples both domains.
            t = np.clip(np.arange(1, 61) / 30.0, 0, 1)
            blend = t**3 * (10 + t * (-15 + 6 * t))
            coefficients = current[None] + blend[:, None] * (target - current)[None]
            for index, value in enumerate(coefficients):
                self.history[side][frame + index] = value.copy()
            self.history[side] = {
                index: value
                for index, value in self.history[side].items()
                if frame - 120 <= index < frame + 60
            }
            sides.append(self.decode(side, coefficients))
        return {
            "modelRevision": MODEL,
            "basis": {
                side: prior["basis"].tolist() for side, prior in self.sides.items()
            },
            "rotations": np.concatenate(sides, axis=1).tolist(),
        }
