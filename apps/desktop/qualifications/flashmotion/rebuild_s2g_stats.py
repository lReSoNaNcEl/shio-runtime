"""Reproduce the release's S2G train statistics using the original BEAT2 assets."""

import argparse
import csv
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from struct import unpack_from
from time import sleep
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import numpy as np
from assets import S2G_STATS_SHA256, fetch_file, verify_file, verify_source

BEAT2_ROOT = (
    "https://huggingface.co/datasets/haiyangliu0/BEAT2/resolve/"
    "8689ecb43513ba31964fd60e0ca69be02d3b0872/beat_english_v2.0.0"
)
SPLIT_SHA256 = "ae51afcfb0df44cbc1730f52789918579efd499c7e15ed6a159a1a34e0332baa"


def download(relative, *, limit=None):
    headers = {"Range": f"bytes=0-{limit - 1}"} if limit else {}
    request = Request(f"{BEAT2_ROOT}/{relative}?download=true", headers=headers)
    for attempt in range(3):
        try:
            with urlopen(request, timeout=45) as response:
                return response.read(limit)
        except (URLError, TimeoutError) as failure:
            if (
                isinstance(failure, HTTPError)
                and failure.code not in (408, 429, 502, 503, 504)
            ) or attempt == 2:
                raise RuntimeError(f"BEAT2 download failed: {relative}") from failure
            sleep(2**attempt)


def audio_sample_count(header):
    if header[:4] != b"RIFF" or header[8:12] != b"WAVE":
        raise ValueError("Expected a BEAT2 RIFF/WAVE header")
    offset = 12
    block_align = 0
    while offset + 8 <= len(header):
        name, size = unpack_from("<4sI", header, offset)
        offset += 8
        if name == b"fmt " and size >= 16 and offset + 16 <= len(header):
            encoding, channels, rate, _, block_align, width = unpack_from(
                "<HHIIHH", header, offset
            )
            if (encoding, width) not in {(1, 16), (1, 24), (1, 32), (3, 32)} or (
                channels != 1 or rate != 16000 or block_align != width // 8
            ):
                raise ValueError("Expected mono 16 kHz PCM or float BEAT2 audio")
        if name == b"data" and block_align and size % block_align == 0:
            return size // block_align
        offset += size + (size % 2)
    raise ValueError("Missing BEAT2 format or data header")


def motion_input(cache, ident):
    path = cache / f"{ident}.npz"
    if path.is_file():
        return
    try:
        speech_seconds = (
            audio_sample_count(download(f"wave16k/{ident}.wav", limit=4096)) // 16000
        )
    except ValueError as failure:
        raise ValueError(f"Invalid BEAT2 audio header: {ident}") from failure
    with np.load(
        BytesIO(download(f"smplxflame_30/{ident}.npz")), allow_pickle=False
    ) as original:
        if (
            "mocap_frame_rate" in original
            and float(original["mocap_frame_rate"].item()) != 30
        ):
            raise ValueError(f"Expected 30 fps BEAT2 motion: {ident}")
        poses = np.asarray(original["poses"][:, :165], dtype=np.float32)
        trans = np.asarray(original["trans"], dtype=np.float32)
    frames = 30 * min(len(poses) // 30, len(trans) // 30, speech_seconds)
    if frames < 30 or poses.shape[1] != 165 or trans.shape[1] != 3:
        raise ValueError(f"Unexpected BEAT2 input shape: {ident}")
    poses, trans = poses[:frames], trans[:frames]
    temporary = path.with_suffix(".partial")
    with temporary.open("wb") as output:
        np.savez(output, poses=poses, trans=trans, source_id=np.asarray(ident))
    temporary.replace(path)


def rebuild(assets, workers, candidate):
    if candidate.exists():
        verify_file(candidate, S2G_STATS_SHA256)
        print(f"Checkpoint-bound normalizer verified: {candidate}", flush=True)
        return
    source = verify_source(assets / "upstream")
    sys.path.insert(0, str(source / "tasks/s2g/snapshots/full55_r2/code"))
    from data import EXPECTED_COUNTS, PERSON_IDS, train_statistics

    cache = assets / "beat2-train"
    split = fetch_file(
        cache / "train_test_split.csv",
        f"{BEAT2_ROOT}/train_test_split.csv",
        SPLIT_SHA256,
    )
    with split.open(encoding="utf-8-sig", newline="") as file:
        ids = [
            row["id"]
            for row in csv.DictReader(file)
            if row["type"] == "train" and int(row["id"].split("_", 1)[0]) in PERSON_IDS
        ]
    if (
        len(ids) != EXPECTED_COUNTS["train"]
        or len(set(ids)) != len(ids)
        or not all(re.fullmatch(r"[0-9]+_[a-z]+(?:_[0-9]+){3}", ident) for ident in ids)
    ):
        raise ValueError("BEAT2 training split differs from the release")
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for count, _ in enumerate(
            pool.map(lambda ident: motion_input(cache, ident), ids), 1
        ):
            if count % 32 == 0:
                print(f"BEAT2 train clips prepared: {count}/{len(ids)}", flush=True)
    train_statistics(
        {"splits": {"train": ids}, "split_csv_sha256": SPLIT_SHA256},
        cache,
        "full55",
        candidate,
    )
    verify_file(candidate, S2G_STATS_SHA256)
    print(f"Checkpoint-bound normalizer verified: {candidate}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("assets", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--workers", type=int, choices=range(1, 17), default=8)
    parser.add_argument("--check", action="store_true", help="Verify an existing normalizer offline")
    args = parser.parse_args()
    assets = args.assets.resolve()
    candidate = (
        args.output.resolve()
        if args.output
        else assets / "reconstructed-stats_full55.npz"
    )
    if args.check:
        verify_file(candidate, S2G_STATS_SHA256)
        print(f"Checkpoint-bound normalizer verified: {candidate}", flush=True)
    else:
        rebuild(assets, args.workers, candidate)


if __name__ == "__main__":
    main()
