"""Conditioning cache validation without loading model weights or CUDA."""

import sys
from types import SimpleNamespace

import pytest
import torch
from safetensors.torch import save_file

import backend
from backend import ArdyBackend


def fixture(monkeypatch, tmp_path):
    monkeypatch.setattr(backend, "ROOT", tmp_path)
    original_to = torch.Tensor.to

    def cpu_to(tensor, *args, **kwargs):
        if args and args[0] == "cuda":
            args = ("cpu", *args[1:])
        return original_to(tensor, *args, **kwargs)

    monkeypatch.setattr(torch.Tensor, "to", cpu_to)
    owner = ArdyBackend.__new__(ArdyBackend)
    owner.torch = torch
    owner.pins = {"textEncoder": [{"revision": "exact-revision"}]}
    owner.embeddings = {}
    calls = []

    def load_encoder():
        calls.append("encoder")
        owner.encoder = SimpleNamespace(encode=lambda *args, **kwargs: torch.ones(1, 4096))

    owner._load_encoder = load_encoder
    owner.reset = lambda seed: None
    owner.generate = lambda *args: None
    profiles = [{"id": "idle", "prompt": "standing calmly", "stationary": True}]
    return owner, profiles, calls


def test_reuses_only_exact_encoder_and_profile_conditioning(monkeypatch, tmp_path):
    owner, profiles, calls = fixture(monkeypatch, tmp_path)
    owner.warmup(profiles)
    assert calls == ["encoder"]
    owner.warmup(profiles)
    assert calls == ["encoder"]
    profiles[0]["prompt"] = "different semantic profile"
    owner.warmup(profiles)
    assert calls == ["encoder", "encoder"]
    owner.pins["textEncoder"][0]["revision"] = "new-exact-revision"
    owner.warmup(profiles)
    assert len(calls) == 3


def test_rejects_embeddings_from_an_incompatible_tokenization_contract(monkeypatch, tmp_path):
    owner, profiles, calls = fixture(monkeypatch, tmp_path)
    owner.warmup(profiles)
    monkeypatch.setattr(backend, "ENCODING_CONTRACT", "a-new-input-template")
    owner.warmup(profiles)
    assert len(calls) == 2
    assert len(list((tmp_path / ".cache" / "conditioning").glob("*.safetensors"))) == 2


def test_offline_lora_composition_preserves_the_pinned_instruct_input(monkeypatch, tmp_path):
    identity = "meta-llama/Meta-Llama-3-8B-Instruct"
    paths = [tmp_path / name for name in ["base", "mntp", "supervised"]]
    model = SimpleNamespace(config=SimpleNamespace(_name_or_path=""))
    tokenizer = SimpleNamespace(eos_token="eos", pad_token=None, padding_side="right")
    events = []
    encoder = SimpleNamespace(
        model=model,
        eval=lambda: events.append("eval"),
        prepare_for_tokenization=lambda text: (
            f"<|start_header_id|>user<|end_header_id|>\n\n{text}<|eot_id|>"
            if model.config._name_or_path == identity
            else text
        ),
    )

    def load_base(base, mntp, **kwargs):
        assert (base, mntp) == tuple(map(str, paths[:2]))
        assert kwargs["merge_peft"] and kwargs["local_files_only"]
        return encoder

    def load_supervised(base, supervised):
        assert base is model and supervised == str(paths[2])
        return SimpleNamespace(to=lambda *args: model)

    def load_tokenizer(mntp, **kwargs):
        assert mntp == str(paths[1]) and kwargs["local_files_only"]
        return tokenizer

    monkeypatch.setitem(
        sys.modules,
        "ardy.model.llm2vec.llm2vec",
        SimpleNamespace(LLM2Vec=SimpleNamespace(from_pretrained=load_base)),
    )
    monkeypatch.setitem(
        sys.modules,
        "peft",
        SimpleNamespace(PeftModel=SimpleNamespace(from_pretrained=load_supervised)),
    )
    monkeypatch.setitem(
        sys.modules,
        "transformers",
        SimpleNamespace(AutoTokenizer=SimpleNamespace(from_pretrained=load_tokenizer)),
    )
    monkeypatch.setattr(backend, "asset_path", lambda entry: entry["path"])
    owner = ArdyBackend.__new__(ArdyBackend)
    owner.encoder = None
    owner.torch = torch
    owner.pins = {"textEncoder": [{"path": path, "repository": identity} for path in paths]}
    owner._load_encoder()
    assert model.config._name_or_path == identity
    assert owner.encoder.tokenizer is tokenizer
    assert tokenizer.pad_token == tokenizer.eos_token and tokenizer.padding_side == "left"
    assert events == ["eval"]


@pytest.mark.parametrize("corruption", ["truncated", "shape", "nonfinite", "names"])
def test_rebuilds_invalid_cache_instead_of_claiming_readiness(monkeypatch, tmp_path, corruption):
    owner, profiles, calls = fixture(monkeypatch, tmp_path)
    owner.warmup(profiles)
    cache = next((tmp_path / ".cache" / "conditioning").glob("*.safetensors"))
    if corruption == "truncated":
        cache.write_bytes(b"not safetensors")
    else:
        value = torch.ones(1, 1, 4096)
        if corruption == "shape":
            value = torch.ones(1, 2)
        if corruption == "nonfinite":
            value[0, 0, 0] = float("nan")
        save_file({"wrong" if corruption == "names" else "idle": value}, str(cache))
    owner.warmup(profiles)
    assert len(calls) == 2
    assert torch.isfinite(owner.embeddings[profiles[0]["prompt"]]).all()
