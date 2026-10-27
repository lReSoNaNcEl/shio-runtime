"""Pinned local ARDY inference. No network, application policy or VRM mutation."""

from __future__ import annotations

import gc
import hashlib
import json
import os
import sys
import tempfile
import time
from pathlib import Path

from research import ROOT, asset_path, load_pins, source_path

ENCODING_CONTRACT = "ardy-llm2vec-instruct-v2"


class ArdyBackend:
    def __init__(self):
        os.environ.update({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"})
        pins = load_pins()
        sys.path.insert(0, str(source_path(pins)))
        import numpy as np
        import torch
        from ardy.model import load_model

        self.np, self.torch = np, torch
        self.pins = pins
        self.encoder = None
        self.model = load_model(
            pins["motion"]["revision"],
            device="cuda",
            text_encoder=False,
            checkpoints_dir=str(asset_path(pins["motion"]).parent),
        )
        self.embeddings = {}
        self.history = None
        self.frame = 0
        self.support_positions = None
        self.support_rotations = None

    def _load_encoder(self):
        if self.encoder is not None:
            return
        from ardy.model.llm2vec.llm2vec import LLM2Vec
        from peft import PeftModel
        from transformers import AutoTokenizer

        torch = self.torch
        base, mntp, supervised = [asset_path(entry) for entry in self.pins["textEncoder"]]
        self.encoder = LLM2Vec.from_pretrained(
            str(base),
            str(mntp),
            merge_peft=True,
            torch_dtype=torch.bfloat16,
            local_files_only=True,
        )
        self.encoder.model = PeftModel.from_pretrained(self.encoder.model, str(supervised)).to(
            "cpu", torch.bfloat16
        )
        # The local base snapshot lacks _name_or_path; the pinned LLM2Vec loader
        # resets it from that JSON. Its instruct formatter dispatches on this
        # identity, so restore the same identity/tokenizer as the official MNTP
        # entry point rather than silently encoding unwrapped plain text.
        self.encoder.model.config._name_or_path = self.pins["textEncoder"][0]["repository"]
        self.encoder.tokenizer = AutoTokenizer.from_pretrained(str(mntp), local_files_only=True)
        self.encoder.tokenizer.pad_token = self.encoder.tokenizer.eos_token
        self.encoder.tokenizer.padding_side = "left"
        self.encoder.eval()
        if self.encoder.prepare_for_tokenization("standing") != (
            "<|start_header_id|>user<|end_header_id|>\n\nstanding<|eot_id|>"
        ):
            raise RuntimeError("ARDY_ENCODER_FORMAT_MISMATCH")

    def reset(self, seed: int):
        self.reseed(seed)
        self.history = None
        self.frame = 0
        self.support_positions = None
        self.support_rotations = None

    def reseed(self, seed: int):
        self.torch.manual_seed(seed)

    def warmup(self, profiles, progress=None):
        from safetensors import SafetensorError
        from safetensors.torch import load_file, save_file

        identity = json.dumps(
            {
                "encoder": self.pins["textEncoder"],
                "encodingContract": ENCODING_CONTRACT,
                "profiles": [(p["id"], p["prompt"]) for p in profiles],
            },
            sort_keys=True,
        )
        key = hashlib.sha256(identity.encode()).hexdigest()
        cache = ROOT / ".cache" / "conditioning" / f"{key}.safetensors"
        tensors = {}
        if cache.is_file() and cache.stat().st_size <= 4_000_000:
            try:
                tensors = load_file(str(cache))
                if set(tensors) != {p["id"] for p in profiles} or any(
                    v.shape != (1, 1, 4096) or not self.torch.isfinite(v).all()
                    for v in tensors.values()
                ):
                    tensors = {}
            except (OSError, ValueError, SafetensorError):
                tensors = {}
        cached = bool(tensors)
        with self.torch.inference_mode():
            for profile in profiles:
                description = profile["prompt"]
                if profile["id"] not in tensors:
                    self._load_encoder()
                    feature = self.encoder.encode(
                        [description], batch_size=1, show_progress_bar=False, device="cpu"
                    )
                    tensors[profile["id"]] = (
                        self.torch.as_tensor(feature)
                        .to("cpu", self.torch.float32)[:, None]
                        .contiguous()
                    )
                self.embeddings[description] = tensors[profile["id"]].to("cuda", self.torch.float32)
                if progress is not None:
                    progress(len(self.embeddings), len(profiles))
        if not cached:
            cache.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                dir=cache.parent, suffix=".tmp", delete=False
            ) as temporary:
                temporary_path = Path(temporary.name)
            try:
                save_file(tensors, str(temporary_path))
                os.replace(temporary_path, cache)
            finally:
                temporary_path.unlink(missing_ok=True)
        self.encoder = None
        gc.collect()
        self.reset(0)
        self.generate(profiles[0]["prompt"], profiles[0]["stationary"])

    def standing_constraint(self, history_length: int, frames: int, device="cuda"):
        """One stage anchor survives profile/phase changes and history replans.

        The pinned end-effector implementation constrains both foot positions and
        rotations plus root heading/height. It does not grant any face authority.
        These are fixed canonical support targets, never renderer-provided poses.
        """
        from ardy.constraints import EndEffectorConstraintSet

        torch, skeleton = self.torch, self.model.skeleton
        if self.support_positions is None:
            positions = (
                skeleton.neutral_joints.detach().clone().to(device=device, dtype=torch.float32)
            )
            positions[:, 1] -= positions[skeleton.foot_joint_idx, 1].min()
            self.support_positions = positions
            offsets = getattr(skeleton, "global_rot_offsets", None)
            self.support_rotations = (
                offsets.detach().clone().to(device=device, dtype=torch.float32)
                if offsets is not None
                else torch.eye(3, device=device).expand(skeleton.nbjoints, 3, 3).clone()
            )
        count = frames - history_length
        return EndEffectorConstraintSet(
            skeleton,
            # The pinned constraint implementation creates joint index tensors on CPU.
            # Keep frame indices there too; only constraint values belong on CUDA.
            frame_indices=torch.arange(history_length, frames),
            global_joints_positions=self.support_positions[None].expand(count, -1, -1),
            global_joints_rots=self.support_rotations[None].expand(count, -1, -1, -1),
            root_2d=torch.zeros((count, 2), device=device),
            joint_names=["LeftFoot", "RightFoot"],
        )

    def generate(self, description: str, stationary: bool, from_frame: int | None = None):
        import torch
        from scipy.spatial.transform import Rotation

        started = time.perf_counter()
        with torch.inference_mode():
            if from_frame is not None:
                if from_frame > self.frame:
                    raise ValueError("Missing continuity history")
                if from_frame < self.frame and self.history is not None:
                    retained = self.history.shape[1] - (self.frame - from_frame)
                    if retained < 0:
                        raise ValueError("Replan exceeds bounded history")
                    self.history = self.history[:, :retained].clone() if retained else None
                self.frame = from_frame
            if description not in self.embeddings:
                if len(self.embeddings) >= 128:
                    raise RuntimeError("Text embedding cache limit exceeded")
                self._load_encoder()
                feature = self.encoder.encode(
                    [description], batch_size=1, show_progress_bar=False, device="cpu"
                )
                self.embeddings[description] = torch.as_tensor(feature).to("cuda", torch.float32)[
                    :, None
                ]
            feature = self.embeddings[description]
            history = None if self.history is None else self.history[:, -60:]
            history_length = 0 if history is None else history.shape[1]
            frames = history_length + 60
            observed, mask = None, None
            if stationary:
                constraint = self.standing_constraint(history_length, frames)
                observed, mask = self.model.motion_rep.create_conditions_from_constraints_batched(
                    [constraint],
                    torch.tensor([frames], device="cuda"),
                    to_normalize=True,
                    device="cuda",
                )
            samples = self.model.autoregressive_step(
                num_frames=frames,
                num_denoising_steps=10,
                cfg_weight=(2.0, 2.0),
                motion_mask=mask,
                observed_motion=observed,
                texts=None,
                text_feat=feature,
                text_pad_mask=torch.ones((1, 1), dtype=torch.bool, device="cuda"),
                init_history_sequence=history,
                init_global_translation=torch.zeros((1, 3), device="cuda")
                if self.history is None
                else None,
                init_first_heading_angle=torch.zeros(1, device="cuda")
                if self.history is None
                else None,
            )
            result = self.model.motion_rep.inverse(
                self.model.motion_rep.unnormalize(samples), is_normalized=False
            )
            fresh = samples[:, -60:]
            self.history = (
                fresh.clone()
                if self.history is None
                else torch.cat((self.history, fresh), dim=1)[:, -120:].clone()
            )
            matrices = result["global_rot_mats"][0, -60:].cpu().numpy()
            offsets = getattr(self.model.skeleton, "global_rot_offsets", None)
            if offsets is not None:
                matrices = matrices @ offsets.cpu().numpy().transpose(0, 2, 1)
            if not self.np.isfinite(matrices).all():
                raise RuntimeError("Non-finite ARDY rotations")
            gram = matrices @ matrices.transpose(0, 1, 3, 2)
            if not self.np.allclose(gram, self.np.eye(3), atol=0.02) or not self.np.allclose(
                self.np.linalg.det(matrices), 1, atol=0.02
            ):
                raise RuntimeError("Invalid ARDY rotation basis")
            rotations = (
                Rotation.from_matrix(matrices.reshape(-1, 3, 3)).as_quat().reshape(60, 30, 4)
            )
            root = result["root_positions"][0, -60:].cpu().numpy()
            contacts = result["foot_contacts"][0, -60:].cpu().numpy().astype(self.np.float32)
            if not self.np.isfinite(root).all() or not self.np.isfinite(contacts).all():
                raise RuntimeError("Non-finite ARDY trajectory")
            output = {
                "startFrame": self.frame,
                "fps": 30,
                "skeleton": "soma30-standard-tpose-v1",
                "rotations": rotations.tolist(),
                "rootPositions": root.tolist(),
                "footContacts": [
                    dict(zip(("leftHeel", "leftToe", "rightHeel", "rightToe"), row.tolist()))
                    for row in contacts
                ],
                "inferenceMs": (time.perf_counter() - started) * 1000,
            }
            self.frame += 60
            return output
