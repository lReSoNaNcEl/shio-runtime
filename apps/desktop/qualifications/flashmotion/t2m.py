"""Generate original FlashMotion T2M poses with two fixed Shio test intents."""

import argparse
import gc
import importlib.util
import json
import statistics
import sys
from pathlib import Path

import numpy as np
import torch
from assets import (
    CHECKPOINTS,
    SOURCE_REVISION,
    UMT5_FILES,
    UMT5_REVISION,
    WEIGHTS_REVISION,
    checkpoint,
    verify_file,
    verify_source,
)
from timing import measure

CATALOG = {
    "quiet-stand": "a person stands still, relaxed, with both arms at their sides",
    "wave-right": "a person raises their right hand and waves hello, then lowers their hand",
}
NATIVE_FPS = 20
FEATURE_DIM = 4096
MOTION_DIM = 263
ENCODING = "UMT5 mean of attention-mask tokens"


def load_encoder(root, device):
    from transformers import AutoTokenizer, UMT5Config, UMT5EncoderModel

    config = UMT5Config.from_pretrained(root, local_files_only=True)
    tokenizer = AutoTokenizer.from_pretrained(root, local_files_only=True)
    with torch.device("meta"):
        encoder = UMT5EncoderModel(config)
    expected = set(encoder.state_dict())
    weight_map = json.loads((root / "pytorch_model.bin.index.json").read_text())[
        "weight_map"
    ]
    names_by_shard = {}
    for name in expected:
        stored_name = (
            "shared.weight"
            if name == "encoder.embed_tokens.weight" and name not in weight_map
            else name
        )
        shard = weight_map[stored_name]
        if shard not in UMT5_FILES:
            raise ValueError(f"Unpinned encoder shard: {shard}")
        names_by_shard.setdefault(shard, []).append((name, stored_name))
    dtype = torch.bfloat16 if device.type == "cuda" else torch.float32
    for shard, names in sorted(names_by_shard.items()):
        tensors = torch.load(
            root / shard, mmap=True, weights_only=True, map_location="cpu"
        )
        transferred = {}
        for name, stored_name in names:
            if stored_name not in transferred:
                transferred[stored_name] = tensors[stored_name].to(
                    device=device, dtype=dtype
                )
        encoder.load_state_dict(
            {name: transferred[stored_name] for name, stored_name in names},
            strict=False,
            assign=True,
        )
        del tensors
    if any(value.is_meta for value in encoder.state_dict().values()):
        raise ValueError("Incomplete UMT5 encoder load")
    return tokenizer, encoder.eval().requires_grad_(False)


@torch.inference_mode()
def encode_catalog(root, device):
    tokenizer, encoder = load_encoder(root, device)
    tokens = tokenizer(
        list(CATALOG.values()),
        return_tensors="pt",
        padding=True,
        truncation=True,
        max_length=128,
    )
    tokens = tokens.to(device)
    output = encoder(**tokens).last_hidden_state.float()
    mask = tokens.attention_mask[..., None]
    # The published bank stores one vector per caption. Its pooling code was
    # not published. This experiment uses a mean over non-padding encoder tokens.
    pooled = ((output * mask).sum(dim=1) / mask.sum(dim=1)).cpu()
    if pooled.shape != (len(CATALOG), FEATURE_DIM) or not torch.isfinite(pooled).all():
        raise ValueError("Invalid UMT5 sentence features")
    return dict(zip(CATALOG, pooled, strict=True))


def catalog_features(assets, device, cache, timings):
    identity = json.dumps(
        {
            "catalog": CATALOG,
            "revision": UMT5_REVISION,
            "encoding": ENCODING,
            "dtype": "bfloat16" if device.type == "cuda" else "float32",
        },
        sort_keys=True,
    )
    if cache and cache.exists():
        with (
            measure(timings, "textCacheRead", cuda=False),
            np.load(cache, allow_pickle=False) as stored,
        ):
            array = stored["embeddings"]
            if (
                stored["identity"].item() != identity
                or array.shape != (len(CATALOG), FEATURE_DIM)
                or array.dtype != np.float32
                or not np.isfinite(array).all()
            ):
                raise ValueError("T2M cache identity or feature shape differs")
            return dict(zip(CATALOG, torch.from_numpy(array), strict=True))
    with measure(timings, "encoderAssetVerification", cuda=False):
        for name, sha256 in UMT5_FILES.items():
            verify_file(assets / "umt5" / name, sha256)
    with measure(timings, "encoderLoadAndFeatures", cuda=device.type == "cuda"):
        features = encode_catalog(assets / "umt5", device)
    if cache:
        partial = cache.with_name(cache.name + ".partial")
        with partial.open("xb") as stream:
            np.savez(
                stream,
                identity=identity,
                embeddings=torch.stack(list(features.values())).numpy(),
            )
        partial.rename(cache)
    return features


def load_motion(source, path):
    sys.path.insert(0, str(source / "tasks/t2m/snapshots/restart_20260922/code"))
    from t2m_long.meanflow import T2MMeanFlow
    from t2m_long.model import OneShotT2MDecoder

    record = torch.load(path, map_location="cpu", mmap=True, weights_only=True)
    metadata = record["metadata"]
    if (
        (record["step"], record["epoch"]) != (100100, 7150)
        or metadata["x0_variant"] != "tr_only"
        or metadata["cross_modal_fusion"] != "adain"
        or metadata["condition_selection"] is not True
        or metadata["direction_fusion"] != "sum"
    ):
        raise ValueError("Unexpected T2M checkpoint identity")
    mean, std = (record["model"][key] for key in ("motion_mean", "motion_std"))
    if (
        mean.shape != (1, 1, MOTION_DIM)
        or std.shape != mean.shape
        or not (
            torch.isfinite(mean).all() and torch.isfinite(std).all() and (std > 0).all()
        )
    ):
        raise ValueError("Invalid checkpoint-bound T2M normalizer")
    decoder = OneShotT2MDecoder(
        cross_modal_fusion="adain", condition_selection=True, direction_fusion="sum"
    )
    ema = record["ema_decoder"]
    if not all(torch.isfinite(value).all() for value in ema.values()):
        raise ValueError("Nonfinite T2M EMA weights")
    decoder.load_state_dict(ema, strict=True)
    motion = T2MMeanFlow(decoder, mean.clone(), std.clone(), x0_variant="tr_only")
    spec = importlib.util.spec_from_file_location(
        "flashmotion_direct_sampler", source / "tasks/t2m/sampling.py"
    )
    sampler = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sampler)
    sampler.install_direct_sampler(motion)
    return motion.eval().requires_grad_(False).cuda()


@torch.inference_mode()
def generate(model, embedding, frames, seed=42):
    from t2m_long.representation import (
        recover_joints_from_ric,
        recover_root_rotation_position,
    )

    condition = (
        embedding.to("cuda").view(1, 1, FEATURE_DIM).expand(1, frames, FEATURE_DIM)
    )
    valid = torch.ones((1, frames), dtype=torch.bool, device="cuda")
    rng = torch.Generator(device="cuda").manual_seed(seed)
    normalized = model.sample(condition, valid, 1, rng)
    motion = (normalized * model.motion_std + model.motion_mean)[0]
    if motion.shape != (frames, MOTION_DIM) or not torch.isfinite(motion).all():
        raise ValueError("Invalid generated HumanML3D motion")
    root_quaternion, root = recover_root_rotation_position(motion)
    return {
        "humanml3d": motion.cpu().numpy(),
        "joints": recover_joints_from_ric(motion).cpu().numpy(),
        "root_world_to_local_wxyz": root_quaternion.cpu().numpy(),
        "root_metres": root.cpu().numpy(),
        "fps": np.array(NATIVE_FPS),
    }


def run(args):
    assets = args.assets.resolve()
    source = verify_source(assets / "upstream")
    path = checkpoint(assets, "t2m")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    encoder_device = torch.device(args.encoder_device)
    torch.set_num_threads(2)
    torch.set_float32_matmul_precision("high")
    free, total = torch.cuda.mem_get_info()
    report = {
        "status": "running",
        "sourceRevision": SOURCE_REVISION,
        "weightsRevision": WEIGHTS_REVISION,
        "checkpointSha256": CHECKPOINTS["t2m"][1],
        "encoderRevision": UMT5_REVISION,
        "encoderDevice": args.encoder_device,
        "encoding": ENCODING,
        "device": torch.cuda.get_device_name(),
        "cuda": torch.version.cuda,
        "torch": str(torch.__version__),
        "cudaFreeBeforeBytes": free,
        "cudaTotalBytes": total,
        "steps": 1,
        "seed": 42,
        "fps": NATIVE_FPS,
        "frames": args.frames,
        "timings": {},
    }
    try:
        features = catalog_features(
            assets, encoder_device, args.text_cache, report["timings"]
        )
        gc.collect()
        torch.cuda.empty_cache()
        with measure(report["timings"], "decoderLoad"):
            model = load_motion(source, path)
        for name, embedding in features.items():
            samples = []
            for attempt in range(args.runs):
                key = f"{name}-{attempt + 1}"
                with measure(report["timings"], key):
                    poses = generate(model, embedding, args.frames)
                if attempt == 0:
                    np.savez_compressed(output / f"{name}.npz", **poses)
                    (output / f"{name}.json").write_text(
                        json.dumps(
                            {
                                "fps": NATIVE_FPS,
                                "joints": poses["joints"].tolist(),
                            },
                            allow_nan=False,
                        )
                        + "\n"
                    )
                else:
                    samples.append(report["timings"][key]["ms"])
            if samples:
                report["timings"][f"{name}-warm"] = {
                    "runs": len(samples),
                    "medianMs": statistics.median(samples),
                    "maxMs": max(samples),
                }
        report["status"] = "generated"
    except Exception as failure:
        report["status"] = "failed"
        report["failure"] = f"{type(failure).__name__}: {failure}"
        raise
    finally:
        (output / "report.json").write_text(
            json.dumps(report, indent=2, allow_nan=False) + "\n"
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("assets", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--frames", type=int, choices=range(4, 201), default=60, metavar="4..200"
    )
    parser.add_argument(
        "--runs", type=int, choices=range(1, 41), default=4, metavar="1..40"
    )
    parser.add_argument("--encoder-device", choices=("cuda", "cpu"), default="cuda")
    parser.add_argument("--text-cache", type=Path)
    run(parser.parse_args())


if __name__ == "__main__":
    main()
