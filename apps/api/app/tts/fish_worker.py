"""Owned subprocess entry point. Provider imports never leak into FastAPI."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def run_worker(source: str, model: str, device: str, compile: bool, requests, responses) -> None:
    allowed = {
        "PATH",
        "Path",
        "SystemRoot",
        "SYSTEMROOT",
        "WINDIR",
        "COMSPEC",
        "PATHEXT",
        "USERPROFILE",
        "USERNAME",
        "USERDOMAIN",
        "USER",
        "LOGNAME",
        "LOCALAPPDATA",
        "APPDATA",
        "PROGRAMFILES",
        "PROGRAMFILES(X86)",
        "PROGRAMDATA",
        "COMMONPROGRAMFILES",
        "COMMONPROGRAMFILES(X86)",
        "SYSTEMDRIVE",
        "HOMEDRIVE",
        "HOMEPATH",
        "NUMBER_OF_PROCESSORS",
        "PROCESSOR_ARCHITECTURE",
        "CUDA_PATH",
        "TEMP",
        "TMP",
        "FISH_VALIDATE_STREAM",
    }
    inherited = {key: value for key, value in os.environ.items() if key in allowed}
    os.environ.clear()
    os.environ.update(inherited)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.chdir(Path(__file__).resolve().parents[2])
    temporary = Path.cwd() / "cache" / "tmp"
    temporary.mkdir(parents=True, exist_ok=True)
    os.environ.update({"TEMP": str(temporary), "TMP": str(temporary), "PYTHONUTF8": "1"})
    os.environ["TRITON_CACHE_DIR"] = str(Path.cwd() / "cache" / "triton")
    os.environ["TORCHINDUCTOR_CACHE_DIR"] = str(Path.cwd() / "cache" / "inductor")
    sys.path.insert(0, source)
    try:
        import numpy as np
        import soundfile as sf
        import torch
        import torchaudio

        def load_audio(file, *args, **kwargs):
            audio, rate = sf.read(file, dtype="float32", always_2d=True)
            return torch.from_numpy(audio.T.copy()), rate

        torchaudio.load = load_audio
        from fish_speech.conversation import Conversation
        from fish_speech.inference_engine import TTSInferenceEngine
        from fish_speech.models.dac import modded_dac
        from fish_speech.models.dac.inference import load_model as load_decoder
        from fish_speech.models.text2semantic import inference
        from fish_speech.utils.schema import ServeReferenceAudio, ServeTTSRequest
        from loguru import logger

        from app.tts.fish_memory import (
            install_bounded_waveform_decode,
            install_speech_context,
            release_unused_codec_masks,
        )
        from app.tts.fish_streaming import install_streaming_decode

        logger.remove()
        Conversation.visualize = lambda *args, **kwargs: None
        inference.tqdm = lambda iterable, **kwargs: iterable
        # The upstream eager loop forces the math attention kernel. Permit
        # PyTorch's supported fused kernels with an explicit math fallback.
        # Sampling and the pinned model remain unchanged.
        from torch.nn.attention import SDPBackend, sdpa_kernel

        inference.sdpa_kernel = lambda _backend: sdpa_kernel(
            [
                SDPBackend.FLASH_ATTENTION,
                SDPBackend.EFFICIENT_ATTENTION,
                SDPBackend.MATH,
            ]
        )

        precision = torch.bfloat16 if device.startswith("cuda") else torch.float32
        install_speech_context(inference)
        decoder = load_decoder("modded_dac_vq", str(Path(model) / "codec.pth"), "cpu")
        release_unused_codec_masks(decoder, modded_dac.WindowLimitedTransformer)
        decoder.to(device)
        install_bounded_waveform_decode(decoder, modded_dac)
        import json

        validation = (
            (lambda metrics: print("FISH_PREFIX_VALIDATION", json.dumps(metrics), flush=True))
            if os.environ.get("FISH_VALIDATE_STREAM") == "1"
            else None
        )
        install_streaming_decode(
            inference,
            decoder,
            lambda pcm: responses.put(("audio", np.asarray(pcm, dtype="<f4"))),
            validate=validation,
        )
        llama_queue = inference.launch_thread_safe_queue(
            checkpoint_path=model,
            device=device,
            precision=precision,
            compile=compile,
        )
        engine = TTSInferenceEngine(
            llama_queue=llama_queue,
            decoder_model=decoder,
            precision=precision,
            compile=False,
            model_family="s2",
        )
        responses.put(("ready", decoder.sample_rate))
        while True:
            request = requests.get()
            if request is None:
                return
            text, reference, transcript = request
            try:
                query = ServeTTSRequest(
                    text=text,
                    references=[
                        ServeReferenceAudio(audio=Path(reference).read_bytes(), text=transcript)
                    ],
                    streaming=True,
                    format="pcm",
                    use_memory_cache="on",
                    max_new_tokens=768,
                    chunk_length=100,
                )
                with torch.inference_mode():
                    tokens, texts = engine.load_references(query)
                    results = engine.send_Llama_request(query, tokens, texts)
                    while True:
                        result = results.get()
                        if result.status == "error":
                            raise RuntimeError(str(result.response))
                        if result.response.action == "next":
                            break
                responses.put(("done", None))
            except Exception as exc:
                responses.put(("error", f"{type(exc).__name__}: {exc}"))
    except Exception as exc:
        responses.put(("error", f"{type(exc).__name__}: {exc}"))
