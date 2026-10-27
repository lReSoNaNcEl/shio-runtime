from types import SimpleNamespace

import numpy as np
import pytest
import torch

from backend import ArdyBackend


def test_soma_native_output_and_bounded_rollback(monkeypatch):
    # Exercise the production backend's frame/history accounting without CUDA or model weights.
    original_ones, original_zeros = torch.ones, torch.zeros
    monkeypatch.setattr(
        torch, "ones", lambda *args, **kw: original_ones(*args, **(kw | {"device": "cpu"}))
    )
    monkeypatch.setattr(
        torch, "zeros", lambda *args, **kw: original_zeros(*args, **(kw | {"device": "cpu"}))
    )
    history_sizes = []

    def step(**kwargs):
        history = kwargs["init_history_sequence"]
        history_sizes.append(0 if history is None else history.shape[1])
        return original_zeros((1, kwargs["num_frames"], 4))

    def inverse(samples, **_kwargs):
        frames = samples.shape[1]
        return {
            "global_rot_mats": torch.eye(3).expand(1, frames, 30, 3, 3).clone(),
            "root_positions": original_zeros((1, frames, 3)),
            "foot_contacts": original_zeros((1, frames, 4)),
        }

    owner = ArdyBackend.__new__(ArdyBackend)
    owner.np, owner.torch = np, torch
    owner.model = SimpleNamespace(
        skeleton=SimpleNamespace(),
        motion_rep=SimpleNamespace(unnormalize=lambda samples: samples, inverse=inverse),
        autoregressive_step=step,
    )
    owner.embeddings = {"test": original_zeros((1, 1, 4096))}
    owner.history, owner.frame = None, 0

    for start in (0, 60, 120):
        result = owner.generate("test", False, start)
        assert result["startFrame"] == start
        assert (result["skeleton"], result["fps"]) == ("soma30-standard-tpose-v1", 30)
        assert np.asarray(result["rotations"]).shape == (60, 30, 4)
        assert len(result["rootPositions"]) == len(result["footContacts"]) == 60
        assert owner.history.shape[1] <= 120
    assert history_sizes == [0, 60, 60]

    owner.generate("test", False, 64)
    assert history_sizes[-1] == 4
    assert owner.frame == 124
    with pytest.raises(ValueError, match="bounded history"):
        owner.generate("test", False, 0)
    with pytest.raises(ValueError, match="Missing continuity history"):
        owner.generate("test", False, 128)
