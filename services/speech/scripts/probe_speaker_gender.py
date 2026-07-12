"""Empirically classify XTTS built-in speakers by perceived gender via median F0.

XTTS v2 speaker *names* don't reliably match the rendered voice gender, so we
synthesize a short sample with each candidate and measure the fundamental
frequency. Run from repo root with the main venv python.
"""
import os
import sys
import numpy as np
import librosa

os.environ.setdefault("COQUI_TOS_AGREED", "1")

CANDIDATES = [
    # current presets
    "Claribel Dervla", "Ana Florence", "Daisy Studious",
    "Damien Black", "Craig Gutsy", "Andrew Chipper",
    # extra male-name candidates
    "Aaron Dreschner", "Baldur Sanjin", "Viktor Menelaos", "Wulf Carlevaro",
    "Marcos Rudaski", "Luis Moray", "Dionisio Schuyler", "Royston Min",
    "Badr Odhiambo", "Abrahan Mack", "Kumar Dahl", "Torcull Diarmuid",
    "Ludvig Milivoj", "Gilberto Mathias", "Filip Traverse", "Damjan Chapman",
    # extra female-name candidates
    "Gracie Wise", "Tammie Ema", "Alison Dietlinde", "Sofia Hellen",
    "Nova Hogarth", "Alexandra Hisakawa", "Rosemary Okafor",
]

TEXT = "This is a short sample used to measure the pitch of this voice."


def median_f0(audio, sr):
    f0, voiced, _ = librosa.pyin(
        audio, sr=sr, fmin=65, fmax=400, frame_length=2048
    )
    f0 = f0[~np.isnan(f0)]
    if f0.size == 0:
        return float("nan")
    return float(np.median(f0))


def main():
    from TTS.api import TTS
    print("loading XTTS...", flush=True)
    model = TTS("tts_models/multilingual/multi-dataset/xtts_v2")
    model.to("cuda")
    available = set(model.speakers)

    results = []
    for spk in CANDIDATES:
        if spk not in available:
            print(f"  SKIP (not in model): {spk}", flush=True)
            continue
        audio = np.asarray(model.tts(text=TEXT, language="en", speaker=spk), dtype=np.float32)
        f0 = median_f0(audio, 24000)
        gender = "male" if f0 < 165 else "female"
        results.append((f0, spk, gender))
        print(f"  {spk:24s} F0={f0:6.1f} Hz -> {gender}", flush=True)

    print("\n=== sorted by F0 (low=male) ===", flush=True)
    for f0, spk, gender in sorted(results):
        print(f"  {f0:6.1f} Hz  {gender:6s}  {spk}", flush=True)


if __name__ == "__main__":
    main()
