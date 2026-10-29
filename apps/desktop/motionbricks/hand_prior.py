"""Native SOMA-X prior projection, not a text/audio-to-hand generative model."""

import hashlib
import json
from pathlib import Path

import numpy as np
from pxr import Usd, UsdSkel
from scipy.optimize import least_squares, lsq_linear
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
                directions = positions[np.asarray(SELECTED) + 1] - positions[SELECTED]
                lengths = np.linalg.norm(directions, axis=1)
                if np.any(lengths < 1e-8):
                    raise ValueError("Degenerate SOMA hand reference finger")
                prior["directions"] = directions / lengths[:, None]
                prior["deviations"] = np.sqrt(np.maximum(prior["eigenvalues"], 1e-12))
                self.sides[side] = prior
        self.reset()

    def reset(self):
        if not hasattr(self, "_fit_cache"):
            self._fit_cache = {}
        self.history = {
            side: {index: np.zeros(32) for index in range(-4, 0)} for side in self.sides
        }
        self.phases = {}

    def target_expmap(self, side, score):
        prior = self.sides[side]
        target = prior["mean"].copy()
        basis = Rotation.from_quat(prior["basis"]).as_matrix()
        across, along, normal = basis.T
        groups = ((0, 3), (5, 8), (10, 13), (15, 18), (20, 23))
        for finger, (start, end) in zip(FINGERS, groups):
            curls = score["fingers"][finger]["curl"]
            for order, joint in enumerate(range(start, end)):
                direction = prior["mean"][joint]
                norm = np.linalg.norm(direction)
                axis = direction / norm if norm > 1e-5 else across
                curl = Rotation.from_rotvec(axis * float(curls[min(order, 2)]))
                # Positive contract spread points toward the index side of
                # the measured palm, independently of left/right bind axes.
                spread = (
                    -normal * float(score["fingers"][finger]["spread"])
                    if order == 0
                    else np.zeros(3)
                )
                opposition = (
                    along * float(score["fingers"][finger]["opposition"])
                    if finger == "thumb" and order == 0
                    else np.zeros(3)
                )
                target[joint] = (
                    Rotation.from_rotvec(spread)
                    * Rotation.from_rotvec(opposition)
                    * curl
                ).as_rotvec()
        return target

    def project(self, side, target):
        prior = self.sides[side]
        coefficients = (
            (target - prior["mean"]).reshape(-1, 72) @ prior["components"].T
        ) / prior["deviations"]
        return np.clip(coefficients, -2.5, 2.5)

    def target_coefficients(self, side, score):
        key = (
            side,
            *(
                float(value)
                for finger in FINGERS
                for value in (
                    *score["fingers"][finger]["curl"],
                    score["fingers"][finger]["spread"],
                    score["fingers"][finger]["opposition"],
                )
            ),
        )
        if key in self._fit_cache:
            return self._fit_cache[key].copy()
        prior = self.sides[side]
        target = self.target_expmap(side, score)
        weights = np.full((24, 3), 0.15)
        for start in (0, 5, 10, 15, 20):
            weights[start : start + 3] = 1
            # MCP orientation moves the complete finger chain, including its
            # spread/opposition. Equal per-joint error let distal PCA coupling
            # erase the semantic opening at the base of otherwise straight fingers.
            weights[start] = 3
        matrix = prior["components"].T * prior["deviations"]
        # Clipping the unconstrained PCA projection independently biased peace
        # fingers back toward the mean. Fit once per phase inside the SAME native
        # coefficient bounds, preserving all selected MCP/PIP/DIP targets.
        fitted = lsq_linear(
            matrix * weights.reshape(-1, 1),
            (target - prior["mean"]).ravel() * weights.ravel(),
            bounds=(-2.5, 2.5),
            method="bvls",
            tol=1e-6,
            max_iter=64,
        )
        if not fitted.success or not np.isfinite(fitted.x).all():
            raise ValueError("SOMA hand target is not representable")
        coefficients = fitted.x
        contrasts = []
        for index, (first, second) in enumerate(zip(FINGERS[1:], FINGERS[2:])):
            a, b = score["fingers"][first], score["fingers"][second]
            if float(a["spread"]) * float(b["spread"]) >= 0:
                continue
            # A small opposed spread is meaningful for straight fingers even
            # when larger flexion targets dominate the ordinary expmap norm.
            weight = min(
                30.0,
                3
                * abs(float(a["spread"]) - float(b["spread"]))
                / max(0.05, abs(float(a["curl"][0])) + abs(float(b["curl"][0]))),
            )
            if weight >= 3:
                contrasts.append((3 * (index + 1), 3 * (index + 2), weight))
        if contrasts:
            coefficients = self._fit_contrasts(side, target, coefficients, contrasts)
        self._fit_cache[key] = coefficients.copy()
        if len(self._fit_cache) > 128:
            del self._fit_cache[next(iter(self._fit_cache))]
        return coefficients

    def _fit_contrasts(self, side, target, initial, contrasts):
        prior = self.sides[side]
        across = Rotation.from_quat(prior["basis"]).as_matrix()[:, 0]
        directions = prior["directions"]
        desired = np.einsum(
            "fij,fj->fi", self._world_delta(side, target[None])[0, SELECTED], directions
        )
        weights = np.tile([3, 1, 1], 5)[None, :, None]

        def residual_batch(coefficients):
            expmap = (
                prior["mean"].reshape(-1)
                + (coefficients * prior["deviations"]) @ prior["components"]
            ).reshape(-1, 24, 3)
            actual = np.einsum(
                "nfij,fj->nfi", self._world_delta(side, expmap)[:, SELECTED], directions
            )
            pose = ((actual - desired) * weights).reshape(len(coefficients), -1)
            gaps = [
                weight
                * (
                    (
                        actual[:, first]
                        - actual[:, second]
                        - desired[first]
                        + desired[second]
                    )
                    @ across
                )
                for first, second, weight in contrasts
            ]
            return np.concatenate(
                (pose, np.stack(gaps, axis=1), 0.02 * (coefficients - initial)), axis=1
            )

        def residual(coefficients):
            return residual_batch(coefficients[None])[0]

        def jacobian(coefficients):
            # Batch finite differences through the native FK instead of running
            # a separate Python/SciPy decode for each of the 32 coefficients.
            steps = np.where(coefficients >= 2.5 - 1e-5, -1e-5, 1e-5)
            probes = np.repeat(coefficients[None], 33, axis=0)
            probes[1:] += np.diag(steps)
            values = residual_batch(probes)
            return ((values[1:] - values[0]) / steps[:, None]).T

        fitted = least_squares(
            residual,
            initial,
            jac=jacobian,
            bounds=(-2.5, 2.5),
            max_nfev=32,
            ftol=1e-5,
            xtol=1e-5,
            gtol=1e-5,
        )
        if not fitted.success or not np.isfinite(fitted.x).all():
            raise ValueError("SOMA hand contrast is not representable")
        return fitted.x

    def decode(self, side, coefficients):
        prior = self.sides[side]
        expmap = (
            prior["mean"].reshape(-1)
            + (coefficients * prior["deviations"]) @ prior["components"]
        )
        delta = self._world_delta(side, expmap.reshape(-1, 24, 3))
        return (
            Rotation.from_matrix(delta[:, SELECTED].reshape(-1, 3, 3))
            .as_quat()
            .reshape(-1, 15, 4)
        )

    def _world_delta(self, side, expmap):
        prior = self.sides[side]
        relative = np.tile(np.eye(3), (len(expmap), 25, 1, 1))
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
        return world @ prior["reference_orient"].swapaxes(-2, -1)

    def generate(self, frame, profile, phase, plan=None, activity=None):
        score = profile["handScore"]["phases"][phase]
        execution = (plan or {}).get("executionId", profile["id"])
        sides = []
        for side in self.sides:
            if frame - 1 not in self.history[side]:
                raise ValueError("Unavailable exact hand history")
            current = self.history[side][frame - 1]
            key = (execution, phase, side)
            if key not in self.phases or frame < self.phases[key][0]:
                self.phases[key] = (
                    frame,
                    current.copy(),
                    self.target_coefficients(side, score[side]),
                )
            origin_frame, origin, fitted = self.phases[key]
            prior = self.sides[side]
            initial = (
                prior["mean"].reshape(-1)
                + (origin * prior["deviations"]) @ prior["components"]
            ).reshape(24, 3)
            target = (
                prior["mean"].reshape(-1)
                + (fitted * prior["deviations"]) @ prior["components"]
            ).reshape(24, 3)
            if phase == "prepare":
                target = initial + (target - initial) * 0.55
            # Temporal articulation is application-authored, separate from the
            # statistical prior. Per-finger timing shares the EXACT body phase
            # and source cursor, including horizon replacement/rollback.
            seconds = (np.arange(frame, frame + 60) - origin_frame + 1) / 30
            duration = (
                next(p["minMs"] for p in profile["phases"] if p["id"] == phase) / 1000
            )
            poses = np.repeat(initial[None], 60, axis=0)
            # Include native metacarpals and end joints in the same finger's
            # transition. Updating only the 15 selected VRM joints made the final
            # PCA projection discard correlated parts of the fitted endpoint.
            for finger, (start, end) in enumerate(
                ((0, 4), (4, 9), (9, 14), (14, 19), (19, 24))
            ):
                timing = score[side]["timing"]
                delay = (
                    duration * timing["start"] + (0.025, 0, 0.018, 0.04, 0.065)[finger]
                )
                reach = min(
                    0.8,
                    max(
                        0.22,
                        duration
                        * (timing["end"] - timing["start"])
                        * (0.75, 0.58, 0.64, 0.82, 0.92)[finger],
                    ),
                )
                t = np.clip((seconds - delay) / reach, 0, 1)
                blend = t**3 * (10 + t * (-15 + 6 * t))
                poses[:, start:end] = initial[start:end] + blend[:, None, None] * (
                    target[start:end] - initial[start:end]
                )
            coefficients = self.project(side, poses)
            for index, value in enumerate(coefficients):
                self.history[side][frame + index] = value.copy()
            self.history[side] = {
                index: value
                for index, value in self.history[side].items()
                if frame - 120 <= index < frame + 60
            }
            sides.append(self.decode(side, coefficients))
        while len(self.phases) > 12:
            del self.phases[next(iter(self.phases))]
        return {
            "modelRevision": MODEL,
            "basis": {
                side: prior["basis"].tolist() for side, prior in self.sides.items()
            },
            "rotations": np.concatenate(sides, axis=1).tolist(),
        }
