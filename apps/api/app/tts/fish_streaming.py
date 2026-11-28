"""Incremental codec delivery around the revision-pinned Fish token decoder.

Upstream S2's HTTP `streaming` flag delivers whole text-batch segments. This
adapter observes completed codebook frames during the same generation and
decodes causal prefixes. The upstream sampler and token result remain intact.
"""

from __future__ import annotations

import inspect


class FishSynthesisCancelled(Exception):
    """The current request reached a safe cancellation checkpoint."""


def install_generation_cancellation(inference, check_cancelled, synchronize) -> None:
    original = inference.generate_long

    def generate_long(**kwargs):
        try:
            check_cancelled()
            yield from original(**kwargs)
        except FishSynthesisCancelled:
            # Let the pinned queue finish normally once outstanding GPU work settles.
            synchronize()
            yield inference.GenerateResponse(action="next")

    inference.generate_long = generate_long


def install_streaming_decode(
    inference,
    decoder,
    emit_pcm,
    *,
    stride: int = 8,
    holdback: int = 2,
    validate=None,
    check_cancelled=lambda: None,
    stream_pcm=lambda: True,
):
    import torch

    original = inference.decode_n_tokens
    signature = inspect.signature(original)
    required = {"model", "cur_token", "input_pos", "num_new_tokens", "decode_one_token"}
    if not required.issubset(signature.parameters):
        raise RuntimeError("Pinned Fish token decoder contract changed")

    def streaming_decode(*args, **kwargs):
        check_cancelled()
        bound = signature.bind(*args, **kwargs)
        bound.apply_defaults()
        model = bound.arguments["model"]
        end_id = model.tokenizer.get_token_id(inference.IM_END_TOKEN)
        first = bound.arguments["cur_token"][0]
        audible = stream_pcm()
        frames = [first[1:].clone()] if audible and int(first[0, -1]) != end_id else []
        emitted = 0
        delivered = [] if validate else None
        delegate = bound.arguments["decode_one_token"]

        def deliver(final=False):
            nonlocal emitted
            check_cancelled()
            if not frames:
                return
            codes = torch.cat(frames, dim=1)
            audio = decoder.from_indices(codes[None])[0].reshape(-1).float()
            samples_per_frame = audio.numel() // codes.shape[1]
            stop = audio.numel() if final else max(0, audio.numel() - holdback * samples_per_frame)
            if stop > emitted:
                pcm = audio[emitted:stop].cpu().numpy().copy()
                check_cancelled()
                if delivered is not None:
                    delivered.append(pcm)
                emit_pcm(pcm)
                emitted = stop
            if final and validate:
                import numpy as np

                actual = np.concatenate(delivered)
                expected = audio.cpu().numpy()
                validate(
                    {
                        "samples": len(actual),
                        "maxError": float(np.max(np.abs(actual - expected))),
                        "rmsError": float(np.sqrt(np.mean((actual - expected) ** 2))),
                    }
                )

        def observe_token(**decode_kwargs):
            check_cancelled()
            token = delegate(**decode_kwargs)
            if audible and int(token[0, -1]) != end_id:
                frames.append(token[1:].clone())
                if len(frames) % stride == 0:
                    deliver()
            return token

        bound.arguments["decode_one_token"] = observe_token
        result = original(*bound.args, **bound.kwargs)
        deliver(final=True)
        return result

    inference.decode_n_tokens = streaming_decode
    return original
