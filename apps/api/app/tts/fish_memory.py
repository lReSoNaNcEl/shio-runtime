"""Bounded allocations for the revision-pinned, full-precision Fish adapter."""

from __future__ import annotations

import inspect
import math
from fractions import Fraction

# Upstream reserves 2048 tokens for generation, so 4096 leaves a 2048-token
# prompt/reference budget for Shio's bounded speech segments.
SPEECH_CONTEXT_LIMIT = 4096


def install_speech_context(inference) -> None:
    model_class = inference.DualARTransformer
    original = model_class.from_pretrained
    if "max_length" not in inspect.signature(original).parameters:
        raise RuntimeError("Pinned Fish model loader contract changed")

    def load_model(path, load_weights=False, max_length=None, rope_base=None):
        if max_length is not None and max_length != SPEECH_CONTEXT_LIMIT:
            raise ValueError("Fish speech context cannot be overridden")
        return original(
            path,
            load_weights=load_weights,
            max_length=SPEECH_CONTEXT_LIMIT,
            rope_base=rope_base,
        )

    model_class.from_pretrained = staticmethod(load_model)


def release_unused_codec_masks(decoder, windowed_transformer) -> int:
    """The pinned windowed forward always supplies its own audio-sized mask.

    Only its unused inherited mask is removed, on CPU before CUDA transfer.
    Ordinary Transformer masks and the request-sized windowed masks stay intact.
    """
    released = 0
    for module in decoder.modules():
        if type(module) is not windowed_transformer:
            continue
        mask = module.causal_mask
        if mask is None or mask.shape != (32768, 32768) or mask.device.type != "cpu":
            raise RuntimeError("Pinned Fish codec mask contract changed")
        released += mask.numel() * mask.element_size()
        module.register_buffer("causal_mask", None, persistent=False)
    if not released:
        raise RuntimeError("Pinned Fish windowed codec contract changed")
    return released


def _waveform_geometry(module, codec) -> tuple[Fraction, int]:
    """Causal left context in input frames, and exact integer upsampling rate."""
    import torch

    kind = type(module)
    if kind is codec.CausalConvNet:
        conv = module.conv
        if conv.stride != (1,) or conv.padding != (0,):
            raise RuntimeError("Pinned Fish waveform convolution changed")
        return Fraction((conv.kernel_size[0] - 1) * conv.dilation[0]), 1
    if kind is codec.CausalTransConvNet:
        conv = module.conv
        stride = conv.stride[0]
        if (
            conv.kernel_size != (2 * stride,)
            or conv.padding != (0,)
            or conv.output_padding != (0,)
            or conv.dilation != (1,)
        ):
            raise RuntimeError("Pinned Fish waveform upsampling changed")
        # Upstream removes only the rightmost stride samples. Each retained
        # output depends on the current and at most one preceding input frame.
        return Fraction(1), stride
    if kind in (codec.Snake1d, torch.nn.Tanh):
        return Fraction(0), 1
    if kind is codec.Decoder:
        children = module.model
    elif kind in (codec.DecoderBlock, codec.ResidualUnit):
        if kind is codec.ResidualUnit and not module.causal:
            raise RuntimeError("Fish waveform residual must be causal")
        children = module.block
    elif kind is torch.nn.Sequential:
        children = module
    else:
        raise RuntimeError("Pinned Fish waveform topology changed")

    context, rate = Fraction(0), 1
    for child in children:
        child_context, child_rate = _waveform_geometry(child, codec)
        context += child_context / rate
        rate *= child_rate
    return context, rate


def install_bounded_waveform_decode(decoder, codec) -> None:
    """Keep waveform activations and CUDA allocation shapes bounded.

    Quantizer/attention still see the complete code prefix. Only the causal
    convolutional waveform stage is tiled, with its full derived left context.
    Right padding is cropped and cannot affect earlier causal output samples.
    """
    import torch
    from torch.nn import functional as functional

    waveform = decoder.decoder
    if type(waveform) is not codec.Decoder:
        raise RuntimeError("Pinned Fish waveform decoder changed")
    context, rate = _waveform_geometry(waveform, codec)
    if rate != decoder.hop_length:
        raise RuntimeError("Fish waveform sample alignment changed")
    history = math.ceil(context)
    block_frames = 128
    original = waveform.forward

    def decode_blocks(z):
        if waveform.training or torch.is_grad_enabled():
            raise RuntimeError("Bounded Fish waveform decode is inference-only")
        parts = []
        for start in range(0, z.shape[-1], block_frames):
            left = max(0, start - history)
            stop = min(z.shape[-1], start + block_frames)
            length = block_frames + start - left
            block = functional.pad(z[..., left:stop], (0, length - (stop - left)))
            audio = original(block)
            if audio.shape[-1] != length * rate:
                raise RuntimeError("Fish waveform output alignment changed")
            parts.append(audio[..., (start - left) * rate : (stop - left) * rate].clone())
        return torch.cat(parts, dim=-1)

    waveform.forward = decode_blocks
