"""Real causal convolutions exercise padding, transposed-conv phase and seams."""

from fractions import Fraction
from types import SimpleNamespace

import pytest
import torch
from torch import nn
from torch.nn import functional as functional

from app.tts.fish_memory import _waveform_geometry, install_bounded_waveform_decode


class CausalConvNet(nn.Module):
    def __init__(self, kernel=7, dilation=1):
        super().__init__()
        self.conv = nn.Conv1d(2, 2, kernel, dilation=dilation)

    def forward(self, x):
        left = (self.conv.kernel_size[0] - 1) * self.conv.dilation[0]
        return self.conv(functional.pad(x, (left, 0)))


class CausalTransConvNet(nn.Module):
    def __init__(self, stride):
        super().__init__()
        self.conv = nn.ConvTranspose1d(2, 2, stride * 2, stride=stride)

    def forward(self, x):
        return self.conv(x)[..., : -self.conv.stride[0]]


class Snake1d(nn.Module):
    def forward(self, x):
        return x + x.sin().square()


class ResidualUnit(nn.Module):
    def __init__(self, dilation):
        super().__init__()
        self.causal = True
        self.block = nn.Sequential(
            Snake1d(), CausalConvNet(dilation=dilation), Snake1d(), CausalConvNet(kernel=1)
        )

    def forward(self, x):
        return x + self.block(x)


class DecoderBlock(nn.Module):
    def __init__(self, stride):
        super().__init__()
        self.block = nn.Sequential(
            Snake1d(),
            CausalTransConvNet(stride),
            *(ResidualUnit(dilation) for dilation in (1, 3, 9)),
        )

    def forward(self, x):
        return self.block(x)


class Decoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.model = nn.Sequential(
            CausalConvNet(),
            *(DecoderBlock(stride) for stride in (8, 8, 4, 2)),
            Snake1d(),
            CausalConvNet(),
            nn.Tanh(),
        )

    def forward(self, x):
        return self.model(x)


CODEC = SimpleNamespace(
    CausalConvNet=CausalConvNet,
    CausalTransConvNet=CausalTransConvNet,
    Snake1d=Snake1d,
    ResidualUnit=ResidualUnit,
    DecoderBlock=DecoderBlock,
    Decoder=Decoder,
)


def test_causal_waveform_tiles_preserve_all_samples_and_bound_allocation_shapes():
    torch.manual_seed(19)
    waveform = Decoder().eval()
    original = waveform.forward
    weights = {name: value.clone() for name, value in waveform.state_dict().items()}
    assert _waveform_geometry(waveform, CODEC) == (Fraction(4757, 256), 512)
    install_bounded_waveform_decode(SimpleNamespace(decoder=waveform, hop_length=512), CODEC)
    lengths = []
    waveform.model[0].register_forward_pre_hook(
        lambda _module, args: lengths.append(args[0].shape[-1])
    )
    with torch.inference_mode():
        for count in (1, 31, 128, 129, 255, 257, 701):
            z = torch.randn(1, 2, count)
            expected = original(z)
            lengths.clear()
            actual = waveform(z)
            assert actual.shape[-1] == count * 512
            assert set(lengths).issubset({128, 147})
            torch.testing.assert_close(actual, expected, atol=2e-6, rtol=1e-5)
    for name, value in waveform.state_dict().items():
        torch.testing.assert_close(value, weights[name], rtol=0, atol=0)


def test_waveform_training_and_unrecognized_noncausal_topology_are_rejected():
    waveform = Decoder()
    install_bounded_waveform_decode(SimpleNamespace(decoder=waveform, hop_length=512), CODEC)
    with pytest.raises(RuntimeError, match="inference-only"):
        waveform(torch.zeros(1, 2, 1))
    with pytest.raises(RuntimeError, match="topology changed"):
        _waveform_geometry(nn.MultiheadAttention(4, 1), CODEC)
    residual = ResidualUnit(1)
    residual.causal = False
    with pytest.raises(RuntimeError, match="must be causal"):
        _waveform_geometry(residual, CODEC)
    with pytest.raises(RuntimeError, match="alignment changed"):
        install_bounded_waveform_decode(SimpleNamespace(decoder=Decoder(), hop_length=256), CODEC)
