from types import SimpleNamespace

import pytest
import torch

from app.tts.fish_memory import (
    SPEECH_CONTEXT_LIMIT,
    install_speech_context,
    release_unused_codec_masks,
)


def test_speech_capacity_is_applied_before_constructing_model_and_caches():
    calls = []

    class Model:
        @staticmethod
        def from_pretrained(path, load_weights=False, max_length=None, rope_base=None):
            calls.append((path, load_weights, max_length, rope_base))
            return SimpleNamespace(mask_shape=(max_length, max_length), cache_length=max_length)

    inference = SimpleNamespace(DualARTransformer=Model)
    install_speech_context(inference)
    model = inference.DualARTransformer.from_pretrained("pinned-model", load_weights=True)
    assert model.mask_shape == (4096, 4096)
    assert model.cache_length == 4096
    assert calls == [("pinned-model", True, SPEECH_CONTEXT_LIMIT, None)]
    with pytest.raises(ValueError, match="cannot be overridden"):
        inference.DualARTransformer.from_pretrained("pinned-model", max_length=32768)
    assert len(calls) == 1


def test_loader_contract_change_is_not_silently_ignored():
    inference = SimpleNamespace(
        DualARTransformer=SimpleNamespace(from_pretrained=lambda path: None)
    )
    with pytest.raises(RuntimeError, match="loader contract changed"):
        install_speech_context(inference)


def test_only_unused_windowed_mask_is_removed_preserving_output_and_state_dict():
    class Transformer(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.register_buffer("causal_mask", torch.ones(4, 4).bool().tril(), persistent=False)
            self.gain = torch.nn.Parameter(torch.tensor(2.0))

        def forward(self, x, mask=None):
            return x @ (self.causal_mask if mask is None else mask).float() * self.gain

    class Windowed(Transformer):
        def forward(self, x):
            # Like the pinned WindowLimitedTransformer, always supplies a mask.
            return super().forward(x, torch.ones(x.shape[-1], x.shape[-1]).bool().tril())

    class HugeCpuMask:
        shape = (32768, 32768)
        device = torch.device("cpu")

        def numel(self):
            return 32768 * 32768

        def element_size(self):
            return 1

    windowed, ordinary = Windowed(), Transformer()
    x = torch.arange(4.0)
    expected = windowed(x)
    state = windowed.state_dict()
    # Stand in for the known 1 GiB unused buffer without allocating it in a test.
    windowed._buffers["causal_mask"] = HugeCpuMask()
    decoder = torch.nn.ModuleList([windowed, ordinary])
    assert release_unused_codec_masks(decoder, Windowed) == 1073741824
    assert windowed.causal_mask is None
    torch.testing.assert_close(windowed(x), expected)
    torch.testing.assert_close(ordinary(x), expected)
    assert windowed.state_dict().keys() == state.keys()
    torch.testing.assert_close(windowed.state_dict()["gain"], state["gain"])
