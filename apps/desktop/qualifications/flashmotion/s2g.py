"""Generate FlashMotion Full55 poses from recorded qualification Fish PCM."""

import argparse
import gc
import importlib.util
import json
import re
import sys
from pathlib import Path

import numpy as np
import torch
from assets import (
    CHECKPOINTS,
    HUBERT_FILES,
    HUBERT_REVISION,
    RU_ALIGN_FILES,
    RU_ALIGN_REVISION,
    S2G_STATS_SHA256,
    SOURCE_REVISION,
    VOCAB_SHA256,
    WEIGHTS_REVISION,
    checkpoint,
    verify_file,
    verify_source,
)
from timing import measure
from torchaudio.functional import forced_align, merge_tokens, resample

SOURCE_RATE = 44100
FEATURE_RATE = 16000
FPS = 30
MAX_SAMPLES = SOURCE_RATE * 45
CASES = ("ru-short", "ru-pause-oov", "ru-long", "en-control")
GLOSS = {
    "привет": "hello",
    "я": "i",
    "рада": "glad",
    "тебя": "you",
    "видеть": "see",
    "сначала": "first",
    "покажу": "show",
    "открытую": "open",
    "ладонь": "palm",
    "а": "and",
    "потом": "then",
    "скажу": "say",
    "необычное": "unusual",
    "слово": "word",
    "давай": "let",
    "начнём": "start",
    "с": "with",
    "простого": "simple",
    "примера": "example",
    "подними": "raise",
    "руку": "hand",
    "и": "and",
    "покажи": "show",
    "два": "two",
    "пальца": "fingers",
    "словно": "like",
    "приветствуешь": "greet",
    "друга": "friend",
    "после": "after",
    "короткой": "short",
    "паузы": "pause",
    "спокойно": "calmly",
    "опусти": "lower",
    "сделай": "take",
    "вдох": "breath",
    "продолжай": "continue",
    "говорить": "speak",
    "в": "in",
    "обычном": "normal",
    "темпе": "pace",
}


def read_case(root, name):
    meta = json.loads((root / f"{name}.json").read_text(encoding="utf-8"))
    if (
        meta["name"] != name
        or meta["sampleRate"] != SOURCE_RATE
        or meta["language"] != name[:2]
        or not 0 < meta["samples"] <= MAX_SAMPLES
        or not 0 < len(meta["text"]) <= 1000
    ):
        raise ValueError("Invalid Fish fixture metadata")
    path = root / f"{name}.f32le"
    if path.stat().st_size != meta["samples"] * 4:
        raise ValueError("Fish fixture sample count differs from metadata")
    pcm = np.fromfile(path, dtype="<f4")
    if not np.isfinite(pcm).all():
        raise ValueError("Nonfinite Fish PCM")
    samples_16k = resample(torch.from_numpy(pcm), SOURCE_RATE, FEATURE_RATE)
    return meta, samples_16k, (len(pcm) * FPS + SOURCE_RATE - 1) // SOURCE_RATE


def to_source_samples(feature_frame, limit):
    # wav2vec2's receptive field is 400 samples with stride 320. Boundaries
    # are halfway between centers: the first center sits 40 samples later.
    return min(limit, (feature_frame * 320 + 40) * SOURCE_RATE // FEATURE_RATE)


@torch.inference_mode()
def align(model, extractor, alphabet, audio, meta):
    words = re.findall(r"[^\W\d_]+", meta["text"].lower(), flags=re.UNICODE)
    tokens = "|".join(words)
    if meta["language"] == "en":
        tokens = tokens.upper()
    if not words or any(char not in alphabet for char in tokens):
        raise ValueError(
            "Fixture contains a character the CTC alphabet cannot represent"
        )
    inputs = extractor(
        audio.numpy(), sampling_rate=FEATURE_RATE, return_tensors="pt"
    ).to("cuda")
    emissions = model(**inputs).logits.log_softmax(dim=-1)
    targets = [alphabet[char] for char in tokens]
    labels, scores = forced_align(
        emissions.cpu(), torch.tensor([targets]), blank=alphabet["<pad>"]
    )
    token_spans = merge_tokens(labels[0], scores[0].exp(), blank=alphabet["<pad>"])
    if [span.token for span in token_spans] != targets:
        raise ValueError("Incomplete CTC alignment")
    result = []
    first = 0
    for word in words:
        spans = token_spans[first : first + len(word)]
        result.append(
            (
                word,
                to_source_samples(spans[0].start, meta["samples"]),
                to_source_samples(spans[-1].end, meta["samples"]),
                float(np.mean([token.score for token in spans])),
            )
        )
        first += len(word) + 1
    return result


def text_features(frames, spans, language, vocab, embeddings):
    tokens = np.zeros(frames, dtype=np.int64)
    known = 0
    previous = 0
    for word, start, end, _ in spans:
        if start < previous or end <= start:
            raise ValueError("Invalid or overlapping word sample interval")
        key = GLOSS.get(word) if language == "ru" else word
        index = vocab.get(key, 3)
        known += index not in (0, 3)
        first = (start * FPS + SOURCE_RATE - 1) // SOURCE_RATE
        last = (end * FPS + SOURCE_RATE - 1) // SOURCE_RATE
        tokens[first:last] = index
        previous = end
    if known == 0:
        raise ValueError("No aligned words present in the BEAT2 vocabulary")
    # Match release storage precision for acoustic and text inputs.
    return embeddings[tokens].astype(np.float16), known


def import_release(source):
    code = source / "tasks/s2g/snapshots/full55_r2/code"
    sys.path.insert(0, str(code))
    from data import Standardizer, decode_motion
    from loss import matrix_to_rotation_6d, rotation_6d_to_matrix
    from model import GestureM2D

    spec = importlib.util.spec_from_file_location(
        "flashmotion_prepare", code / "prepare.py"
    )
    prepare = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(prepare)
    return (
        Standardizer,
        decode_motion,
        matrix_to_rotation_6d,
        rotation_6d_to_matrix,
        GestureM2D,
        prepare,
    )


def run(args):
    from transformers import HubertForCTC, Wav2Vec2FeatureExtractor, Wav2Vec2ForCTC

    assets = args.assets.resolve()
    source = verify_source(assets / "upstream")
    stats_path = (
        verify_file(args.stats.resolve(), S2G_STATS_SHA256) if args.stats else None
    )
    weights_path = checkpoint(assets, "s2g") if stats_path else None
    vocab_path = verify_file(assets / "vocab.pkl", VOCAB_SHA256)
    for folder, files in (("hubert", HUBERT_FILES), ("ru-align", RU_ALIGN_FILES)):
        for name, sha256 in files.items():
            verify_file(assets / folder / name, sha256)

    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    torch.set_num_threads(2)
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    timings = {}
    free, total = torch.cuda.mem_get_info()
    report = {
        "status": "running",
        "sourceRevision": SOURCE_REVISION,
        "weightsRevision": WEIGHTS_REVISION,
        "checkpointSha256": CHECKPOINTS["s2g"][1],
        "normalizerSha256": S2G_STATS_SHA256 if stats_path else None,
        "hubertRevision": HUBERT_REVISION,
        "russianAlignmentRevision": RU_ALIGN_REVISION,
        "scope": "offline fixture alignment; Russian test words use a fixture gloss in the BEAT2 embedding space",
        "cuda": torch.version.cuda,
        "torch": str(torch.__version__),
        "device": torch.cuda.get_device_name(),
        "cudaFreeBeforeBytes": free,
        "cudaTotalBytes": total,
        "steps": 1,
        "seed": 42,
        "speakerCondition": 2,
        "fps": FPS,
        "timings": timings,
        "cases": {},
    }
    try:
        stats_class, decode, mat_to_6d, rot6d_to_mat, gesture, prepare = import_release(
            source
        )
        vocab, embeddings = prepare.read_vocabulary(vocab_path)
        cases = {}
        for name in CASES:
            cases[name] = read_case(args.pcm, name)
        features = {}
        for language, folder, cls in (
            ("ru", "ru-align", Wav2Vec2ForCTC),
            ("en", "hubert", HubertForCTC),
        ):
            model_root = assets / folder
            alphabet = json.loads(
                (model_root / "vocab.json").read_text(encoding="utf-8")
            )
            with measure(timings, f"{language}-alignmentLoad"):
                extractor = Wav2Vec2FeatureExtractor.from_pretrained(
                    model_root, local_files_only=True
                )
                aligner = (
                    cls.from_pretrained(
                        model_root, local_files_only=True, use_safetensors=False
                    )
                    .eval()
                    .requires_grad_(False)
                    .cuda()
                )
            for name, (meta, audio, frames) in cases.items():
                if meta["language"] != language:
                    continue
                with measure(timings, f"{name}-alignment"):
                    spans = align(aligner, extractor, alphabet, audio, meta)
                    text, known = text_features(
                        frames, spans, language, vocab, embeddings
                    )
                features[name] = {"text": text}
                report["cases"][name] = {
                    "frames": frames,
                    "sourceSamples": meta["samples"],
                    "alignedWords": len(spans),
                    "vocabularyWords": known,
                    "sourceIntervals": [
                        {"start": start, "end": end, "confidence": confidence}
                        for _, start, end, confidence in spans
                    ],
                }
            if language == "en":
                for name, (_, audio, frames) in cases.items():
                    with measure(timings, f"{name}-hubert"):
                        features[name]["audio"] = prepare.hubert_features(
                            aligner.hubert,
                            extractor,
                            audio.numpy(),
                            frames,
                            torch.device("cuda"),
                        )
            del aligner
            gc.collect()
            torch.cuda.empty_cache()
        if stats_path is None:
            report["status"] = "features-ready"
            return
        stats = stats_class.load(stats_path)
        if stats.mean.shape != (333,):
            raise ValueError("Unexpected Full55 normalizer size")
        with measure(timings, "decoderLoad"):
            state = torch.load(
                weights_path, map_location="cpu", mmap=True, weights_only=True
            )
            if (
                state["epoch"] != 3200
                or state["metadata"]["normalizer_sha256"] != S2G_STATS_SHA256
            ):
                raise ValueError("Unexpected S2G checkpoint identity")
            config = json.loads(
                (
                    source / "tasks/s2g/snapshots/full55_r2/code/config.target.json"
                ).read_text()
            )
            model = gesture(mode="full55", **config["architecture"])
            if state["architecture"] != model.architecture_config():
                raise ValueError("Unexpected Full55 architecture")
            model.load_state_dict(state["model"], strict=True)
            del state
            model = model.eval().requires_grad_(False).cuda()
        mean = torch.tensor(stats.mean, device="cuda")
        std = torch.tensor(stats.std, device="cuda")

        def project(value):
            physical = value * std + mean
            rotations = rot6d_to_mat(
                physical[..., :-3].reshape(*physical.shape[:-1], 55, 6)
            )
            physical[..., :-3] = mat_to_6d(rotations).flatten(-2)
            return (physical - mean) / std

        with torch.inference_mode():
            for name, (meta, _, frames) in cases.items():
                for attempt in range(args.runs):
                    with measure(timings, f"{name}-generate-{attempt + 1}"):
                        generator = torch.Generator(device="cuda").manual_seed(42)
                        noise = torch.randn(
                            (1, frames, 333), generator=generator, device="cuda"
                        )
                        prediction = model.sample(
                            noise,
                            steps=1,
                            project_func=project,
                            **{
                                key: torch.from_numpy(value).cuda().float().unsqueeze(0)
                                for key, value in features[name].items()
                            },
                            person_id=torch.tensor([2], device="cuda"),
                            padding_mask=torch.ones(
                                (1, frames), dtype=torch.bool, device="cuda"
                            ),
                        )
                        raw = stats.denormalize(prediction[0].cpu().numpy())
                        rotations, root = decode(raw, "full55")
                    if attempt == 0:
                        rotations = rotations.reshape(frames, 55, 3)
                        np.savez_compressed(
                            out / f"{name}.npz",
                            local_axis_angle_raw=rotations,
                            root_metres=root,
                            fps=np.array(FPS),
                            source_samples=np.array(meta["samples"]),
                        )
                        (out / f"{name}.json").write_text(
                            json.dumps(
                                {
                                    "fps": FPS,
                                    "localAxisAngleRaw": rotations.tolist(),
                                    "root": root.tolist(),
                                },
                                allow_nan=False,
                            )
                            + "\n"
                        )
        report["status"] = "generated"
    except Exception as failure:
        report["status"] = "failed"
        report["failure"] = f"{type(failure).__name__}: {failure}"
        raise
    finally:
        (out / "report.json").write_text(
            json.dumps(report, indent=2, allow_nan=False) + "\n"
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("assets", type=Path)
    parser.add_argument("pcm", type=Path)
    parser.add_argument("output", type=Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--stats", type=Path)
    mode.add_argument("--features-only", action="store_true")
    parser.add_argument(
        "--runs", type=int, choices=range(1, 11), default=4, metavar="1..10"
    )
    run(parser.parse_args())


if __name__ == "__main__":
    main()
