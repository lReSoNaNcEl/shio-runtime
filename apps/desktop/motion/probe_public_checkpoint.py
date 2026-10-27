"""Public-checkpoint diagnostic only: no semantic/text-encoder qualification."""

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["TORCH_HOME"] = str(ROOT / "cache" / "torch")


def main():
    import numpy as np
    import torch

    from research import ARTIFACTS, asset_path, load_pins, source_path

    pins = load_pins()
    sys.path.insert(0, str(source_path(pins)))
    from ardy.model import load_model

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    model = load_model(
        load_pins()["motion"]["revision"],
        device="cuda",
        text_encoder=False,
        checkpoints_dir=str(asset_path(load_pins()["motion"]).parent),
    )
    torch.cuda.synchronize()
    loaded = time.perf_counter()
    history = None
    latencies = []
    outputs = []
    with torch.inference_mode():
        torch.manual_seed(42)
        for _ in range(25):
            step = time.perf_counter()
            n_history = 0 if history is None else history.shape[1]
            samples = model.autoregressive_step(
                num_frames=n_history + model.gen_horizon_len,
                num_denoising_steps=10,
                cfg_weight=(0.0, 0.0),
                motion_mask=None,
                observed_motion=None,
                texts=None,
                text_feat=torch.zeros((1, 1, 4096), device="cuda"),
                text_pad_mask=torch.ones((1, 1), device="cuda", dtype=torch.bool),
                init_history_sequence=history,
                init_global_translation=(
                    torch.zeros((1, 3), device="cuda") if history is None else None
                ),
                init_first_heading_angle=(
                    torch.zeros(1, device="cuda") if history is None else None
                ),
            )
            result = model.motion_rep.inverse(
                model.motion_rep.unnormalize(samples), is_normalized=False
            )
            torch.cuda.synchronize()
            latencies.append((time.perf_counter() - step) * 1000)
            outputs.append(result["local_rot_mats"][0, -model.gen_horizon_len :].cpu().numpy())
            history = samples[:, -pins["motion"]["historyFrames"] :].clone()
    rotations = np.concatenate(outputs)
    assert np.isfinite(rotations).all()
    np.savez(ARTIFACTS / "unconditional-diagnostic.npz", local_rot_mats=rotations)
    report = {
        "qualification": False,
        "reason": "Unconditional diagnostic; text encoder deliberately not used",
        "sourceRevision": load_pins()["source"]["revision"],
        "motionRevision": load_pins()["motion"]["revision"],
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "loadMs": (loaded - started) * 1000,
        "frames": len(rotations),
        "fps": model.motion_rep.fps,
        "horizon": model.gen_horizon_len,
        "historyFramesLimit": pins["motion"]["historyFrames"],
        "stepMedianMs": float(np.median(latencies[1:])),
        "stepP95Ms": float(np.percentile(latencies[1:], 95)),
        "firstStepMs": latencies[0],
        "peakGpuAllocatedBytes": torch.cuda.max_memory_allocated(),
        "peakGpuReservedBytes": torch.cuda.max_memory_reserved(),
        "skeleton": type(model.skeleton).__name__,
        "skeletonFields": list(vars(model.skeleton)),
        "jointNames": model.skeleton.bone_order_names,
        "outputKeys": list(result),
        "rotationShape": list(rotations.shape),
        "finite": True,
    }
    (ARTIFACTS / "ardy-public-checkpoint.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
