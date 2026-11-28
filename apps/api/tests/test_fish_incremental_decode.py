from types import SimpleNamespace

import numpy as np
import pytest
import torch

from app.tts.fish_streaming import (
    FishSynthesisCancelled,
    install_generation_cancellation,
    install_streaming_decode,
)


@pytest.mark.parametrize("audible", [True, False])
def test_incremental_hook_preserves_tokens_and_only_emits_audible_pcm(audible):
    frames = [torch.tensor([[1], [value], [value]]) for value in range(1, 24)]
    terminal = torch.tensor([[99], [0], [0]])

    def decode_n_tokens(model, cur_token, input_pos, num_new_tokens, decode_one_token):
        tokens = [cur_token[0]]
        for index in range(num_new_tokens):
            token = decode_one_token(index=index)
            tokens.append(token)
            if int(token[0, -1]) == 99:
                break
        return torch.cat(tokens, dim=1)

    class Decoder:
        def from_indices(self, codes):
            assert audible, "conditioning must not decode a waveform"
            return codes[:, :1].float().repeat_interleave(3, dim=-1)

    inference = SimpleNamespace(decode_n_tokens=decode_n_tokens, IM_END_TOKEN="end")
    model = SimpleNamespace(tokenizer=SimpleNamespace(get_token_id=lambda _: 99))
    chunks = []
    install_streaming_decode(
        inference, Decoder(), chunks.append, stride=4, holdback=2, stream_pcm=lambda: audible
    )

    def delegate(**kwargs):
        return frames[kwargs["index"] + 1] if kwargs["index"] + 1 < len(frames) else terminal

    result = inference.decode_n_tokens(model, frames[0][None], None, 24, delegate)
    if audible:
        np.testing.assert_array_equal(np.concatenate(chunks), np.repeat(np.arange(1, 24), 3))
        assert len(chunks) > 2
    else:
        assert chunks == []
    assert result.shape == (3, 24)
    assert int(result[0, -1]) == 99


def test_decoder_revision_mismatch_fails_closed():
    inference = SimpleNamespace(decode_n_tokens=lambda unknown: None)
    with pytest.raises(RuntimeError, match="contract changed"):
        install_streaming_decode(inference, None, lambda _: None)


@pytest.mark.parametrize("audible", [True, False])
def test_cancellation_stops_decoding_and_synchronizes_before_terminal_result(audible):
    cancelled = False
    actions = []
    model = SimpleNamespace(tokenizer=SimpleNamespace(get_token_id=lambda _: 99))
    frame = torch.tensor([[1], [2], [2]])

    def decode_n_tokens(model, cur_token, input_pos, num_new_tokens, decode_one_token):
        for _ in range(num_new_tokens):
            decode_one_token()

    def decode_one_token():
        nonlocal cancelled
        actions.append("token")
        if not audible and len(actions) == 3:
            cancelled = True
        return frame

    def generate_long():
        inference.decode_n_tokens(model, frame[None], None, 12, decode_one_token)
        yield SimpleNamespace(action="sample")

    def check_cancelled():
        if cancelled:
            raise FishSynthesisCancelled()

    def emit(_pcm):
        nonlocal cancelled
        actions.append("pcm")
        cancelled = True

    def from_indices(codes):
        return codes[:, :1].float()

    inference = SimpleNamespace(
        decode_n_tokens=decode_n_tokens,
        generate_long=generate_long,
        GenerateResponse=SimpleNamespace,
        IM_END_TOKEN="end",
    )
    install_generation_cancellation(inference, check_cancelled, lambda: actions.append("gpu-idle"))
    install_streaming_decode(
        inference,
        SimpleNamespace(from_indices=from_indices),
        emit,
        stride=4,
        holdback=2,
        check_cancelled=check_cancelled,
        stream_pcm=lambda: audible,
    )

    responses = list(inference.generate_long())
    assert [response.action for response in responses] == ["next"]
    assert actions == ["token"] * 3 + (["pcm"] if audible else []) + ["gpu-idle"]
