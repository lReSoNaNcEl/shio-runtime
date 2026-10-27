"""Canonical support constraints without loading CUDA or model weights."""

import sys
from types import SimpleNamespace

import pytest
import torch

from backend import ArdyBackend


def test_bilateral_end_effector_anchor_survives_phase_and_profile_changes(monkeypatch):
    captured = []
    monkeypatch.setitem(
        sys.modules,
        "ardy.constraints",
        SimpleNamespace(
            EndEffectorConstraintSet=lambda skeleton, **kwargs: captured.append(kwargs) or kwargs
        ),
    )
    owner = ArdyBackend.__new__(ArdyBackend)
    owner.torch = torch
    owner.support_positions = owner.support_rotations = None
    neutral = torch.tensor(
        [[0.0, 0.0, 0.0], [-0.1, -1.0, 0.0], [0.1, -1.0, 0.0]], dtype=torch.float64
    )
    owner.model = SimpleNamespace(
        skeleton=SimpleNamespace(neutral_joints=neutral, foot_joint_idx=[1, 2], nbjoints=3)
    )
    first = owner.standing_constraint(0, 8, "cpu")
    anchor = first["global_joints_positions"].clone()
    assert anchor.dtype == torch.float32
    assert first["global_joints_rots"].dtype == torch.float32
    neutral.add_(12.0)
    next_phase = owner.standing_constraint(8, 16, "cpu")
    assert next_phase["joint_names"] == ["LeftFoot", "RightFoot"]
    assert torch.equal(next_phase["frame_indices"], torch.arange(8, 16))
    assert torch.equal(next_phase["global_joints_positions"], anchor)
    assert torch.equal(anchor[:, [1, 2], 1], torch.zeros(8, 2))
    assert torch.equal(next_phase["root_2d"], torch.zeros(8, 2))


@pytest.mark.skipif(not torch.cuda.is_available(), reason="CUDA constraint boundary")
def test_cuda_support_values_keep_cpu_index_pairs(monkeypatch):
    captured = []
    monkeypatch.setitem(
        sys.modules,
        "ardy.constraints",
        SimpleNamespace(
            EndEffectorConstraintSet=lambda skeleton, **kwargs: captured.append(kwargs) or kwargs
        ),
    )
    owner = ArdyBackend.__new__(ArdyBackend)
    owner.torch = torch
    owner.support_positions = owner.support_rotations = None
    owner.model = SimpleNamespace(
        skeleton=SimpleNamespace(
            neutral_joints=torch.tensor([[0.0, 0.0, 0.0], [-0.1, -1.0, 0.0], [0.1, -1.0, 0.0]]),
            foot_joint_idx=[1, 2],
            nbjoints=3,
        )
    )
    constraint = owner.standing_constraint(0, 8, "cuda")
    frames = constraint["frame_indices"]
    joints = torch.tensor([1, 2])
    # Mirror the pinned EndEffectorConstraintSet.create_pairs indexing contract.
    pairs = torch.stack((frames[:, None].expand(-1, 2), joints.expand(8, -1)), dim=-1).reshape(
        -1, 2
    )
    values = constraint["global_joints_positions"]
    assert frames.device.type == "cpu"
    assert values.device.type == "cuda"
    assert values[tuple(pairs.T)].shape == (16, 3)
