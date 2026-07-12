from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.audio import save_wav
from app.config import settings
from app.tts.f5_local import F5LocalEngine
from app.tts.voices import default_voice_id, resolve_reference, voice_registry


OUT_DIR = ROOT / "logs" / "f5_long_playback_audit"

PROBLEM_TEXT = (
    "Мне кажется, что SpringBones можно использовать не только для волос и одежды, "
    "но и для мягкого покачивания аксессуаров персонажа. Если настроить их осторожно, "
    "модель будет выглядеть живее, даже когда просто стоит на месте и слушает собеседника."
)

TEXT_CASES = {
    "05s": "Мне кажется, что SpringBones можно использовать для волос.",
    "10s": "Мне кажется, что SpringBones можно использовать для волос, одежды и небольших аксессуаров персонажа.",
    "20s": (
        "Мне кажется, что SpringBones можно использовать для волос, одежды и небольших аксессуаров персонажа. "
        "Если настроить их осторожно, модель будет выглядеть живее во время простоя."
    ),
    "30s": PROBLEM_TEXT,
    "40s": (
        PROBLEM_TEXT
        + " Особенно важно не переборщить с амплитудой, потому что слишком сильные движения быстро начинают выглядеть искусственно."
    ),
    "60s": (
        PROBLEM_TEXT
        + " Особенно важно не переборщить с амплитудой, потому что слишком сильные движения быстро начинают выглядеть искусственно. "
        "Лучше добавить несколько очень слабых слоёв движения: дыхание, лёгкий наклон головы, редкий взгляд в сторону и плавное возвращение в спокойное состояние."
    ),
}


@dataclass
class AudioStats:
    duration_sec: float
    speech_duration_sec: float
    tail_duration_sec: float
    rms: float
    tail_rms: float
    spectral_centroid_hz: float
    tail_spectral_centroid_hz: float
    clipping_ratio: float
    dc_offset: float
    noise_floor_rms: float


def read_mono(path: Path) -> tuple[np.ndarray, int]:
    data, sr = sf.read(path, dtype="float32", always_2d=False)
    if data.ndim > 1:
        data = data.mean(axis=1)
    return np.asarray(data, dtype=np.float32), int(sr)


def write_wav(path: Path, data: np.ndarray, sr: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, np.asarray(data, dtype=np.float32), sr)


def spectral_centroid(data: np.ndarray, sr: int) -> float:
    if len(data) < 512:
        return 0.0
    window = np.hanning(len(data))
    spectrum = np.abs(np.fft.rfft(data * window))
    freqs = np.fft.rfftfreq(len(data), d=1.0 / sr)
    total = float(np.sum(spectrum))
    if total <= 1e-12:
        return 0.0
    return float(np.sum(freqs * spectrum) / total)


def frame_rms(data: np.ndarray, frame: int, hop: int) -> np.ndarray:
    if len(data) < frame:
        return np.array([], dtype=np.float32)
    values = []
    for start in range(0, len(data) - frame + 1, hop):
        chunk = data[start : start + frame]
        values.append(math.sqrt(float(np.mean(chunk * chunk))))
    return np.asarray(values, dtype=np.float32)


def analyze_audio(path: Path) -> AudioStats:
    data, sr = read_mono(path)
    duration = len(data) / sr if sr else 0.0
    rms = float(np.sqrt(np.mean(data * data))) if len(data) else 0.0
    dc = float(np.mean(data)) if len(data) else 0.0
    clipping = float(np.mean(np.abs(data) >= 0.999)) if len(data) else 0.0

    frame = max(512, int(sr * 0.05))
    hop = max(128, int(sr * 0.02))
    rms_frames = frame_rms(data, frame, hop)
    if len(rms_frames):
        noise_floor = float(np.percentile(rms_frames, 10))
        threshold = max(noise_floor * 3.0, rms * 0.08, 0.0025)
        voiced = np.where(rms_frames > threshold)[0]
    else:
        noise_floor = 0.0
        voiced = np.array([], dtype=np.int64)

    if len(voiced):
        speech_end_sample = min(len(data), int((voiced[-1] * hop) + frame))
        speech_start_sample = max(0, int(voiced[0] * hop))
        speech_duration = max(0.0, (speech_end_sample - speech_start_sample) / sr)
    else:
        speech_end_sample = 0
        speech_duration = 0.0

    tail = data[speech_end_sample:]
    tail_duration = len(tail) / sr if sr else 0.0
    tail_rms = float(np.sqrt(np.mean(tail * tail))) if len(tail) else 0.0

    return AudioStats(
        duration_sec=duration,
        speech_duration_sec=speech_duration,
        tail_duration_sec=tail_duration,
        rms=rms,
        tail_rms=tail_rms,
        spectral_centroid_hz=spectral_centroid(data, sr),
        tail_spectral_centroid_hz=spectral_centroid(tail, sr),
        clipping_ratio=clipping,
        dc_offset=dc,
        noise_floor_rms=noise_floor,
    )


def make_reference_variant(source_wav: Path, source_txt: Path, target_sec: float, out_dir: Path) -> tuple[Path, Path]:
    data, sr = read_mono(source_wav)
    ref_text = source_txt.read_text(encoding="utf-8").strip()
    target_samples = int(target_sec * sr)
    silence = np.zeros(int(0.18 * sr), dtype=np.float32)
    parts: list[np.ndarray] = []
    text_parts: list[str] = []
    total = 0
    while total < target_samples:
        chunk = data[: max(0, min(len(data), target_samples - total))]
        if len(chunk) == 0:
            break
        parts.append(chunk)
        text_parts.append(ref_text)
        total += len(chunk)
        if total < target_samples:
            gap = silence[: max(0, min(len(silence), target_samples - total))]
            parts.append(gap)
            total += len(gap)

    variant = np.concatenate(parts)[:target_samples]
    wav_path = out_dir / f"reference_{target_sec:g}s.wav"
    txt_path = out_dir / f"reference_{target_sec:g}s.txt"
    write_wav(wav_path, variant, sr)
    txt_path.write_text(" ".join(text_parts), encoding="utf-8")
    return wav_path, txt_path


def peak_normalize(audio: np.ndarray) -> np.ndarray:
    max_val = float(np.max(np.abs(audio))) if len(audio) else 0.0
    if max_val <= 0:
        return audio.astype(np.float32)
    return (audio / max_val).astype(np.float32)


def save_response_wav(path: Path, audio: np.ndarray, sr: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(save_wav(audio, sr))


def load_engine() -> F5LocalEngine:
    return F5LocalEngine(
        device=settings.DEVICE,
        model_id=settings.F5_MODEL_ID,
        ckpt_subpath=settings.F5_CKPT_SUBPATH,
        vocab_subpath=settings.F5_VOCAB_SUBPATH,
        use_accent=settings.F5_USE_ACCENT,
        nfe_step=settings.F5_NFE_STEP,
        cfg_strength=settings.F5_CFG_STRENGTH,
        force_duration=settings.F5_TTS_FORCE_DURATION,
        max_chunk_chars=settings.F5_CHUNK_MAX_CHARS,
        max_chunk_seconds=settings.F5_CHUNK_MAX_SECONDS,
        chunk_crossfade_ms=settings.F5_CHUNK_CROSSFADE_MS,
        tail_validation=settings.F5_TAIL_VALIDATION,
        target_rms_db=settings.F5_TARGET_RMS_DB,
    )


def infer_one(
    engine: F5LocalEngine,
    ref_wav: Path,
    ref_txt: Path,
    text: str,
    language: str,
    speed: float,
    fix_mode: str,
    seed: int,
) -> tuple[np.ndarray, int, dict]:
    ref_text = ref_txt.read_text(encoding="utf-8").strip()
    gen_text = engine._accent(engine._normalize_text(text, language), language)
    ref_text = engine._accent(engine._normalize_text(ref_text, language), language)
    ref_duration = engine._audio_duration_sec(str(ref_wav))
    estimate = engine._estimate_generated_duration(gen_text, speed)
    fix_duration = None
    if fix_mode == "service":
        fix_duration = min(ref_duration, 6.0) + estimate
    elif fix_mode == "estimate_only":
        fix_duration = estimate

    started = time.perf_counter()
    wav, sr, meta = engine.model.infer(
        ref_file=str(ref_wav),
        ref_text=ref_text,
        gen_text=gen_text,
        nfe_step=engine._nfe_step,
        cfg_strength=engine._cfg_strength,
        speed=speed,
        fix_duration=fix_duration,
        remove_silence=False,
        seed=seed,
        show_info=lambda *a, **k: None,
    )
    elapsed_ms = (time.perf_counter() - started) * 1000
    return np.asarray(wav, dtype=np.float32), int(sr), {
        "fix_duration": fix_duration,
        "estimated_generated_duration": estimate,
        "reference_duration": ref_duration,
        "elapsed_ms": elapsed_ms,
        "meta": str(meta),
    }


def append_row(rows: list[dict], case: dict, stage: str, path: Path) -> None:
    stats = analyze_audio(path)
    rows.append({
        **case,
        "stage": stage,
        "path": str(path),
        **stats.__dict__,
    })


def run_regression(args: argparse.Namespace) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    voice_registry.reload()
    voice_id = args.voice_id or default_voice_id()
    resolved = resolve_reference(voice_id)
    if resolved is None:
        raise SystemExit(f"Voice {voice_id!r} has no usable reference")

    _source_wav, _source_text, entry = resolved
    run_dir = OUT_DIR / time.strftime("%Y%m%d_%H%M%S_regression")
    audio_dir = run_dir / "audio"
    run_dir.mkdir(parents=True, exist_ok=True)

    engine = load_engine()
    if engine.model is None:
        raise SystemExit("F5 model did not load; regression cannot continue")
    if args.nfe_step is not None:
        engine._nfe_step = int(args.nfe_step)
    if args.cfg_strength is not None:
        engine._cfg_strength = float(args.cfg_strength)

    rows: list[dict] = []
    failures: list[str] = []
    for text_case in args.text_cases:
        text = TEXT_CASES[text_case]
        print(f"[regression] {text_case}")
        result = engine.synthesize(
            text=text,
            language=args.language,
            emotion="neutral",
            voice=voice_id,
            speed=args.speed,
        )
        path = audio_dir / f"{text_case}_response.wav"
        save_response_wav(path, result.audio, result.sample_rate)
        stats = analyze_audio(path)
        debug_chunks = list(getattr(engine, "last_debug_chunks", []))
        case = {
            "case": text_case,
            "voice_id": voice_id,
            "voice_label": entry.label,
            "text_chars": len(text),
            "chunks": len(debug_chunks),
            "chunk_trimmed_sec": sum(float(item.get("trimmed_sec", 0.0)) for item in debug_chunks),
            "chunk_suspicious": sum(1 for item in debug_chunks if item.get("suspicious")),
            "duration_sec": stats.duration_sec,
            "speech_duration_sec": stats.speech_duration_sec,
            "tail_duration_sec": stats.tail_duration_sec,
            "rms": stats.rms,
            "tail_rms": stats.tail_rms,
            "spectral_centroid_hz": stats.spectral_centroid_hz,
            "tail_spectral_centroid_hz": stats.tail_spectral_centroid_hz,
            "clipping_ratio": stats.clipping_ratio,
            "dc_offset": stats.dc_offset,
            "noise_floor_rms": stats.noise_floor_rms,
            "path": str(path),
        }
        rows.append(case)

        if stats.clipping_ratio > 0.001:
            failures.append(f"{text_case}: clipping_ratio={stats.clipping_ratio:.5f}")
        if stats.tail_duration_sec >= 5.0 and stats.tail_rms > 0.004:
            failures.append(f"{text_case}: suspicious response tail {stats.tail_duration_sec:.2f}s rms={stats.tail_rms:.5f}")
        if text_case in {"30s", "40s", "60s"} and len(debug_chunks) <= 1:
            failures.append(f"{text_case}: expected chunking, got {len(debug_chunks)} chunk")

    csv_path = run_dir / "regression_metrics.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    (run_dir / "chunks.json").write_text(
        json.dumps({
            "voice_id": voice_id,
            "force_duration": settings.F5_TTS_FORCE_DURATION,
            "max_chunk_chars": settings.F5_CHUNK_MAX_CHARS,
            "max_chunk_seconds": settings.F5_CHUNK_MAX_SECONDS,
            "rows": rows,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[regression] metrics: {csv_path}")
    if failures:
        print("[regression] FAIL")
        for failure in failures:
            print(f"  - {failure}")
        raise SystemExit(1)
    print("[regression] PASS")


def run(args: argparse.Namespace) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    voice_registry.reload()
    voice_id = args.voice_id or default_voice_id()
    resolved = resolve_reference(voice_id)
    if resolved is None:
        raise SystemExit(f"Voice {voice_id!r} has no usable reference")

    source_wav, source_text, entry = resolved
    source_wav_path = Path(source_wav)
    source_txt_path = entry.reference_text

    run_dir = OUT_DIR / time.strftime("%Y%m%d_%H%M%S")
    run_dir.mkdir(parents=True, exist_ok=True)
    references_dir = run_dir / "references"
    audio_dir = run_dir / "audio"

    ref_variants: list[tuple[str, Path, Path]] = [("original", source_wav_path, source_txt_path)]
    for seconds in args.reference_seconds:
        wav_path, txt_path = make_reference_variant(source_wav_path, source_txt_path, seconds, references_dir)
        ref_variants.append((f"{seconds:g}s_looped", wav_path, txt_path))

    engine = load_engine()
    if engine.model is None:
        raise SystemExit("F5 model did not load; audit cannot continue")
    if args.nfe_step is not None:
        engine._nfe_step = int(args.nfe_step)
    if args.cfg_strength is not None:
        engine._cfg_strength = float(args.cfg_strength)

    config = {
        "voice_id": voice_id,
        "voice_label": entry.label,
        "source_reference": source_wav,
        "source_reference_text": source_text,
        "model_id": settings.F5_MODEL_ID,
        "ckpt_subpath": settings.F5_CKPT_SUBPATH,
        "vocab_subpath": settings.F5_VOCAB_SUBPATH,
        "device": settings.DEVICE,
        "nfe_step": engine._nfe_step,
        "cfg_strength": engine._cfg_strength,
        "speed": args.speed,
        "seed": args.seed,
        "fix_modes": args.fix_modes,
        "text_cases": list(args.text_cases),
        "reference_variants": [name for name, _, _ in ref_variants],
    }
    (run_dir / "config.json").write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")

    rows: list[dict] = []
    for ref_name, ref_wav, ref_txt in ref_variants:
        for text_case in args.text_cases:
            text = TEXT_CASES[text_case]
            for fix_mode in args.fix_modes:
                case_name = f"{ref_name}__{text_case}__{fix_mode}"
                print(f"[audit] {case_name}")
                raw, sr, meta = infer_one(
                    engine=engine,
                    ref_wav=ref_wav,
                    ref_txt=ref_txt,
                    text=text,
                    language=args.language,
                    speed=args.speed,
                    fix_mode=fix_mode,
                    seed=args.seed,
                )
                normalized = peak_normalize(raw)
                raw_path = audio_dir / case_name / "01_raw_infer.wav"
                normalized_path = audio_dir / case_name / "02_peak_normalized.wav"
                response_path = audio_dir / case_name / "03_response_int16.wav"
                write_wav(raw_path, raw, sr)
                write_wav(normalized_path, normalized, sr)
                save_response_wav(response_path, normalized, sr)

                case = {
                    "case": case_name,
                    "voice_id": voice_id,
                    "reference_variant": ref_name,
                    "reference_path": str(ref_wav),
                    "reference_duration": meta["reference_duration"],
                    "text_case": text_case,
                    "text_chars": len(text),
                    "fix_mode": fix_mode,
                    "fix_duration": meta["fix_duration"],
                    "estimated_generated_duration": meta["estimated_generated_duration"],
                    "inference_ms": meta["elapsed_ms"],
                    "sample_rate": sr,
                    "nfe_step": engine._nfe_step,
                    "cfg_strength": engine._cfg_strength,
                    "speed": args.speed,
                    "seed": args.seed,
                }
                append_row(rows, case, "raw_infer", raw_path)
                append_row(rows, case, "peak_normalized", normalized_path)
                append_row(rows, case, "response_int16", response_path)

    csv_path = run_dir / "metrics.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    print(f"[audit] metrics: {csv_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--regression", action="store_true", help="Run current service-path long playback regression")
    parser.add_argument("--voice-id", default="")
    parser.add_argument("--language", default="ru")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--seed", type=int, default=1234)
    parser.add_argument("--text-cases", nargs="+", default=["05s", "10s", "20s", "30s", "40s", "60s"], choices=TEXT_CASES.keys())
    parser.add_argument("--fix-modes", nargs="+", default=["service", "none"], choices=["service", "none", "estimate_only"])
    parser.add_argument("--reference-seconds", nargs="+", type=float, default=[2, 3, 5, 10, 15])
    parser.add_argument("--nfe-step", type=int, default=None)
    parser.add_argument("--cfg-strength", type=float, default=None)
    return parser.parse_args()


if __name__ == "__main__":
    parsed = parse_args()
    if parsed.regression:
        run_regression(parsed)
    else:
        run(parsed)
